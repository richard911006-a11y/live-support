import { mountChatWidget } from './index';

const container = document.getElementById('live-support-widget');

if (container !== null) {
  const configuredWorkerBaseUrl = import.meta.env.VITE_WORKER_BASE_URL?.trim();
  const workerBaseUrl = configuredWorkerBaseUrl || container.dataset.workerBaseUrl?.trim();

  mountChatWidget(
    container,
    workerBaseUrl === undefined || workerBaseUrl.length === 0
      ? undefined
      : { connection: { baseUrl: workerBaseUrl } },
  );
}
