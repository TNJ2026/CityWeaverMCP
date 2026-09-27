using System;
using System.Collections.Generic;
using Game.Prefabs;
using Newtonsoft.Json.Linq;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private static string PrefabSourceCategory(bool dlc, bool mod, bool login, bool unresolved)
        {
            if (unresolved) return "unknown";
            int count = (dlc ? 1 : 0) + (mod ? 1 : 0) + (login ? 1 : 0);
            if (count > 1) return "mixed_requirements";
            return dlc ? "dlc" : mod ? "mod" : login ? "account_reward" : "no_declared_requirement";
        }

        // Requirements describe availability, not the release in which an asset appeared.
        private JObject PrefabSource(World world, Entity entity)
        {
            var em = world.EntityManager;
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var requirements = new JArray();
            var packs = new JArray();
            var evidence = new JArray();
            var seen = new HashSet<Entity>();
            bool dlc = false, mod = false, login = false, unresolved = false;
            bool unavailable = false, availabilityUnknown = false;
            bool? builtin = null, subscribed = null;
            if (prefabs.TryGetPrefab<PrefabBase>(entity, out var asset))
            {
                try
                {
                    builtin = asset.isBuiltin;
                    subscribed = asset.isSubscribedMod;
                    mod = subscribed == true;
                    evidence.Add("PrefabBase.isBuiltin/isSubscribedMod");
                }
                catch (Exception) { unresolved = true; evidence.Add("asset_origin_unavailable"); }
            }
            else { unresolved = true; evidence.Add("prefab_unavailable"); }

            void AddRequirement(Entity content, string via)
            {
                evidence.Add(via);
                if (!seen.Add(content)) return;
                var row = new JObject { ["entity_id"] = EntityId(content), ["via"] = via };
                requirements.Add(row);
                if (content == Entity.Null || !em.Exists(content) || !em.HasComponent<ContentData>(content))
                {
                    unresolved = true; availabilityUnknown = true; row["status"] = "unresolved"; return;
                }
                var data = em.GetComponentData<ContentData>(content);
                bool needsDlc = (data.m_Flags & ContentFlags.RequireDlc) != 0;
                dlc |= needsDlc;
                mod |= (data.m_Flags & ContentFlags.RequireMod) != 0;
                login |= (data.m_Flags & ContentFlags.RequirePdxLogin) != 0;
                if ((data.m_Flags & ~(ContentFlags.RequireDlc | ContentFlags.RequireMod | ContentFlags.RequirePdxLogin)) != 0)
                    unresolved = true;
                row["status"] = "resolved";
                row["flags"] = data.m_Flags.ToString();
                row["flags_value"] = (int)data.m_Flags;
                row["dlc_id"] = needsDlc ? new JValue(data.m_DlcID) : JValue.CreateNull();
                row["dlc_display_name"] = null;
                row["mod_id"] = null;
                row["available"] = null;
                if (prefabs.TryGetPrefab<PrefabBase>(content, out var contentPrefab))
                {
                    row["content_prefab"] = contentPrefab.name;
                    if (contentPrefab is ContentPrefab gate)
                    {
                        try
                        {
                            bool available = gate.IsAvailable();
                            row["available"] = available;
                            unavailable |= !available;
                        }
                        catch (Exception) { availabilityUnknown = true; }
                    }
                    else availabilityUnknown = true;
                    if (needsDlc && contentPrefab.TryGet<DlcRequirement>(out var requirement))
                    {
                        try { row["dlc_display_name"] = requirement.GetDebugString(); }
                        catch (Exception) { row["name_status"] = "unavailable"; }
                    }
                    if (contentPrefab.TryGet<ModRequirement>(out var modRequirement)) row["mod_id"] = modRequirement.m_ModId;
                }
                else availabilityUnknown = true;
            }

            if (em.HasComponent<ContentData>(entity)) AddRequirement(entity, "ContentData");
            if (em.HasComponent<ContentPrerequisiteData>(entity))
                AddRequirement(em.GetComponentData<ContentPrerequisiteData>(entity).m_ContentPrerequisite, "ContentPrerequisiteData");
            if (em.HasComponent<ModPrerequisiteData>(entity))
                AddRequirement(em.GetComponentData<ModPrerequisiteData>(entity).m_ContentPrerequisite, "ModPrerequisiteData");
            if (em.HasBuffer<AssetPackElement>(entity))
            {
                evidence.Add("AssetPackElement");
                var elements = em.GetBuffer<AssetPackElement>(entity, true);
                for (int i = 0; i < elements.Length; i++)
                {
                    var pack = elements[i].m_Pack;
                    var resolved = pack != Entity.Null && em.Exists(pack) && prefabs.TryGetPrefab<PrefabBase>(pack, out _);
                    packs.Add(new JObject { ["entity_id"] = EntityId(pack),
                        ["name"] = resolved ? prefabs.GetPrefabName(pack) : null, ["status"] = resolved ? "resolved" : "unresolved" });
                }
            }
            return new JObject { ["category"] = PrefabSourceCategory(dlc, mod, login, unresolved),
                ["content_available"] = unavailable ? new JValue(false) : unresolved || availabilityUnknown ? JValue.CreateNull() : new JValue(true),
                ["is_builtin_asset"] = builtin.HasValue ? new JValue(builtin.Value) : JValue.CreateNull(),
                ["is_subscribed_mod"] = subscribed.HasValue ? new JValue(subscribed.Value) : JValue.CreateNull(),
                ["requirements_complete"] = !unresolved, ["content_requirements"] = requirements,
                ["asset_packs"] = packs, ["evidence"] = evidence,
                ["base_game_status"] = "unverified",
                ["note"] = "Direct prefab requirements and pack membership only. No declared requirement does not prove base-game origin; built-in assets can include DLC or free updates. DLC labels are native runtime labels, not a hardcoded ID map." };
        }
    }
}
