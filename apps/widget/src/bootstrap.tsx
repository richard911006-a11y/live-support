import { mountChatWidget, type ChatWidgetProps } from './index';

const container = document.getElementById('live-support-widget');

if (container !== null) {
  const configuredWorkerBaseUrl = import.meta.env.VITE_WORKER_BASE_URL?.trim();
  const workerBaseUrl = configuredWorkerBaseUrl || container.dataset.workerBaseUrl?.trim();
  const embedMode =
    new URLSearchParams(window.location.search).get('embed') === '1' ||
    container.dataset.embed?.toLowerCase() === 'true';

  const props: ChatWidgetProps = {
    ...(workerBaseUrl === undefined || workerBaseUrl.length === 0
      ? {}
      : { connection: { baseUrl: workerBaseUrl } }),
    ...(embedMode ? { autoButton: false, initialOpen: true } : {}),
  };

  mountChatWidget(container, props);
}
