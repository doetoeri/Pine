import { getExperimentPlatform } from "../next/experiment/experiment-service.js";

const toggle = document.querySelector("#experiment-notification-toggle");
const status = document.querySelector("#experiment-notification-status");
if (toggle && status) {
  try {
    const platform = await getExperimentPlatform();
    if (!platform.user) {
      status.textContent = "PinCon에 로그인하면 이 계정의 실험 알림 수신 여부를 변경할 수 있습니다.";
    } else {
      let enabled = await platform.notificationExperimentEnabled();
      const render = () => {
        status.textContent = enabled
          ? "현재 연구 알림 수신: 허용. 실제 발송에는 브라우저 알림 권한이 필요합니다."
          : "현재 연구 알림 수신: 중지. 다른 기기에도 동일하게 적용됩니다.";
        toggle.textContent = enabled ? "실험 알림 중지" : "실험 알림 다시 허용";
        toggle.disabled = false;
      };
      render();
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        status.textContent = "설정을 저장하는 중입니다.";
        try {
          const result = await platform.setNotificationExperimentEnabled(!enabled);
          enabled = result.enabled;
          render();
        } catch (error) {
          status.textContent = error?.message || "설정을 저장하지 못했습니다.";
          toggle.disabled = false;
        }
      });
    }
  } catch {
    status.textContent = "설정을 불러오지 못했습니다. 로그인 및 네트워크 상태를 확인하세요.";
  }
}
