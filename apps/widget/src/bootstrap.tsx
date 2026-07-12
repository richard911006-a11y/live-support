import { mountChatWidget } from './index';

const container = document.getElementById('live-support-widget');

if (container !== null) {
  mountChatWidget(container);
}
