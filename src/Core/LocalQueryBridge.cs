using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Colossal.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace CityWeaver
{
    // Newline-delimited JSON on an ephemeral loopback port; MCP lives outside Unity.
    public sealed class LocalQueryBridge : IDisposable
    {
        private static LocalQueryBridge s_Current;

        private sealed class Pending
        {
            public JObject Request;
            public DateTime Deadline = DateTime.UtcNow.AddSeconds(10);
            public TaskCompletionSource<JObject> Result = new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private readonly GameQueryService m_Queries;
        private readonly ConcurrentQueue<Pending> m_Queue = new ConcurrentQueue<Pending>();
        private readonly SemaphoreSlim m_Clients = new SemaphoreSlim(8);
        private readonly ConcurrentDictionary<TcpClient, byte> m_OpenClients = new ConcurrentDictionary<TcpClient, byte>();
        private readonly CancellationTokenSource m_Stop = new CancellationTokenSource();
        private TcpListener m_Listener;
        private string m_Token;
        private string m_EndpointPath;
        private bool m_Registered;
        private Guid m_UpdaterId;

        public static bool IsRunning => Volatile.Read(ref s_Current) != null;

        // AutomaticSettings polls this value and refreshes read-only status fields when it changes.
        public static int GetStatusVersion() => IsRunning ? 1 : 0;

        public LocalQueryBridge(GameQueryService queries) { m_Queries = queries; }

        public void Start()
        {
            try
            {
                var bytes = new byte[32];
                using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
                m_Token = Convert.ToBase64String(bytes);
                m_Listener = new TcpListener(IPAddress.Loopback, 0);
                m_Listener.Start(8);
                var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "..", "LocalLow", "Colossal Order", "Cities Skylines II", "ModsData", "CityWeaver");
                Directory.CreateDirectory(directory);
                m_EndpointPath = Path.Combine(directory, "bridge.json");
                File.WriteAllText(m_EndpointPath, new JObject {
                    ["protocol_version"] = 1, ["host"] = "127.0.0.1",
                    ["port"] = ((IPEndPoint)m_Listener.LocalEndpoint).Port,
                    ["token"] = m_Token, ["process_id"] = System.Diagnostics.Process.GetCurrentProcess().Id
                }.ToString(Formatting.None), new UTF8Encoding(false));
                m_UpdaterId = MainThreadDispatcher.RegisterUpdater(Pump);
                m_Registered = true;
                Volatile.Write(ref s_Current, this);
                _ = AcceptLoop();
                Mod.log.Info("Read-only query bridge started on loopback. Endpoint: " + Path.GetFullPath(m_EndpointPath));
            }
            catch (Exception ex)
            {
                Dispose();
                Mod.log.Error(ex, "Could not start query bridge");
            }
        }

        private async Task AcceptLoop()
        {
            while (!m_Stop.IsCancellationRequested)
            {
                try
                {
                    var client = await m_Listener.AcceptTcpClientAsync().ConfigureAwait(false);
                    if (!m_Clients.Wait(0)) { client.Close(); continue; }
                    m_OpenClients.TryAdd(client, 0);
                    _ = Serve(client);
                }
                catch (Exception) when (m_Stop.IsCancellationRequested) { break; }
                catch (Exception ex) { Mod.log.Warn("Query listener failed: " + ex.GetType().Name); break; }
            }
        }

        private async Task Serve(TcpClient client)
        {
            try
            {
                using (client)
                using (var lifetime = CancellationTokenSource.CreateLinkedTokenSource(m_Stop.Token))
                {
                    lifetime.CancelAfter(TimeSpan.FromSeconds(12));
                    using (lifetime.Token.Register(() => client.Close()))
                    using (var stream = client.GetStream())
                    {
                        var buffer = new byte[8192];
                        var count = 0;
                        var end = -1;
                        while (end < 0 && count < buffer.Length)
                        {
                            var read = await stream.ReadAsync(buffer, count, buffer.Length - count, lifetime.Token).ConfigureAwait(false);
                            if (read == 0) return;
                            end = Array.IndexOf(buffer, (byte)'\n', count, read);
                            count += read;
                        }
                        if (end < 0) return;
                        JObject response;
                        try
                        {
                            var request = JObject.Parse(Encoding.UTF8.GetString(buffer, 0, end), new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                            if ((string)request["token"] != m_Token) response = Error("UNAUTHORIZED", "Invalid bridge token.");
                            else if ((int?)request["protocol_version"] != 1) response = Error("PROTOCOL_MISMATCH", "Expected protocol_version 1.");
                            else if (request["tool"]?.Type != JTokenType.String || (request["arguments"] != null && request["arguments"].Type != JTokenType.Object)) response = Error("INVALID_REQUEST", "Expected tool string and arguments object.");
                            else
                            {
                                if (m_Queue.Count >= 32) response = Error("BUSY", "Game query queue is full. Retry later.");
                                else
                                {
                                    var pending = new Pending { Request = request };
                                    m_Queue.Enqueue(pending);
                                    var completed = await Task.WhenAny(pending.Result.Task, Task.Delay(10000, lifetime.Token)).ConfigureAwait(false);
                                    if (completed == pending.Result.Task) response = await pending.Result.Task.ConfigureAwait(false);
                                    else { pending.Result.TrySetCanceled(); response = Error("GAME_TIMEOUT", "Game did not process the query. It may be loading or not updating."); }
                                }
                            }
                        }
                        catch (JsonException) { response = Error("INVALID_REQUEST", "Invalid JSON request."); }
                        var payload = Encoding.UTF8.GetBytes(response.ToString(Formatting.None) + "\n");
                        if (payload.Length > 1500000) payload = Encoding.UTF8.GetBytes(Error("RESPONSE_TOO_LARGE", "Request fewer entities/components or a smaller buffer_limit.").ToString(Formatting.None) + "\n");
                        await stream.WriteAsync(payload, 0, payload.Length, lifetime.Token).ConfigureAwait(false);
                    }
                }
            }
            catch (Exception ex) when (ex is IOException || ex is ObjectDisposedException || ex is OperationCanceledException || ex is SocketException) { }
            catch (Exception ex) { Mod.log.Warn("Query connection failed: " + ex.GetType().Name); }
            finally
            {
                m_OpenClients.TryRemove(client, out _);
                m_Clients.Release();
            }
        }

        // Dispatcher runs on Unity's main thread even when simulation is paused.
        private bool Pump()
        {
            if (m_Stop.IsCancellationRequested) return true;
            for (var i = 0; i < 2 && m_Queue.TryDequeue(out var pending); i++)
            {
                if (pending.Result.Task.IsCompleted || DateTime.UtcNow > pending.Deadline) continue;
                try { pending.Result.TrySetResult(m_Queries.Execute(pending.Request)); }
                catch (QueryException ex) { pending.Result.TrySetResult(Error(ex.Code, ex.Message)); }
                catch (Exception ex)
                {
                    Mod.log.Error(ex, "Game query failed");
                    pending.Result.TrySetResult(Error("QUERY_FAILED", "Game query failed; consult the mod log."));
                }
            }
            return false;
        }

        internal static JObject Error(string code, string message) => new JObject {
            ["ok"] = false, ["error"] = new JObject { ["code"] = code, ["message"] = message }
        };

        public void Dispose()
        {
            if (m_Stop.IsCancellationRequested) return;
            m_Stop.Cancel();
            Interlocked.CompareExchange(ref s_Current, null, this);
            m_Listener?.Stop();
            foreach (var client in m_OpenClients.Keys) client.Close();
            if (m_Registered) MainThreadDispatcher.UnregisterUpdater(m_UpdaterId);
            while (m_Queue.TryDequeue(out var pending)) pending.Result.TrySetCanceled();
            try
            {
                if (m_EndpointPath != null && File.Exists(m_EndpointPath) && (string)JObject.Parse(File.ReadAllText(m_EndpointPath))["token"] == m_Token)
                    File.Delete(m_EndpointPath);
            }
            catch (Exception ex) { Mod.log.Warn("Could not remove bridge endpoint: " + ex.GetType().Name); }
        }
    }
}
