using Game;
using Game.Rendering;
using Unity.Mathematics;
using UnityEngine;

namespace CityWeaver
{
    // Runs in PreCulling before the native camera update, including while paused.
    public partial class McpCameraFocusSystem : GameSystemBase
    {
        private CameraController m_Controller;
        private float3 m_StartPivot;
        private float3 m_TargetPivot;
        private float2 m_StartAngle;
        private float2 m_TargetAngle;
        private float m_StartZoom;
        private float m_TargetZoom;
        private float m_Duration;
        private float m_Elapsed;
        private bool m_Active;
        private bool m_HasAppliedFrame;
        private float3 m_LastAppliedPivot;

        public bool active => m_Active;
        public string status { get; private set; } = "idle";

        protected override void OnCreate()
        {
            base.OnCreate();
            Enabled = false;
        }

        public bool Begin(float3 targetPivot, float targetZoom, float2? targetAngle, float duration)
        {
            var cameraSystem = World.GetExistingSystemManaged<CameraUpdateSystem>();
            m_Controller = cameraSystem?.gamePlayController;
            if (m_Controller == null || !m_Controller.controllerEnabled) return false;
            m_StartPivot = m_Controller.pivot;
            m_StartAngle = m_Controller.angle;
            m_StartZoom = m_Controller.zoom;
            m_TargetPivot = targetPivot;
            m_TargetAngle = targetAngle ?? m_StartAngle;
            m_TargetZoom = math.clamp(targetZoom, m_Controller.zoomRange.min, m_Controller.zoomRange.max);
            m_Duration = math.max(.05f, duration);
            m_Elapsed = 0;
            m_Active = true;
            status = "scheduled";
            m_HasAppliedFrame = false;
            Enabled = true;
            return true;
        }

        private bool HasUserCameraInput()
        {
            foreach (var action in m_Controller.inputActions)
                if (action != null && action.IsInProgress()) return true;
            if (!m_HasAppliedFrame) return false;
            var pivot = (float3)m_Controller.pivot;
            return math.distancesq(pivot.xz, m_LastAppliedPivot.xz) > .0025f;
        }

        private void CancelForUserInput()
        {
            m_Active = false;
            status = "cancelled_by_user";
            Enabled = false;
            Mod.log.Info("Automatic construction camera focus cancelled because the user changed the view.");
        }

        protected override void OnUpdate()
        {
            if (!m_Active || m_Controller == null || !m_Controller.controllerEnabled)
            {
                if (m_Active) status = "camera_unavailable";
                m_Active = false;
                Enabled = false;
                return;
            }
            if (HasUserCameraInput())
            {
                CancelForUserInput();
                return;
            }
            m_Elapsed += UnityEngine.Time.unscaledDeltaTime;
            status = "moving";
            var linear = math.saturate(m_Elapsed / m_Duration);
            var eased = linear * linear * (3f - 2f * linear);
            m_Controller.pivot = math.lerp(m_StartPivot, m_TargetPivot, eased);
            m_Controller.angle = CameraController.LerpAngle(m_StartAngle, m_TargetAngle, eased);
            m_Controller.zoom = math.lerp(m_StartZoom, m_TargetZoom, eased);
            m_LastAppliedPivot = m_Controller.pivot;
            m_HasAppliedFrame = true;
            if (linear < 1f) return;
            m_Controller.pivot = m_TargetPivot;
            m_Controller.angle = m_TargetAngle;
            m_Controller.zoom = m_TargetZoom;
            m_Active = false;
            status = "completed";
            Enabled = false;
        }
    }
}
