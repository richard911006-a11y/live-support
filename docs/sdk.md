# JavaScript SDK

`@live-support/widget` 同时提供传统的 `mountChatWidget()` 挂载方式和可编程的 `LiveSupport` SDK。默认配置不会改变现有浮动按钮、窗口样式或 WebSocket 行为。

## 默认模式

```ts
import { LiveSupport } from '@live-support/widget';

const support = LiveSupport.init({
  worker: 'https://your-worker.workers.dev',
});
```

未设置 `autoButton` 时，SDK 会创建右下角浮动按钮。`worker` 是可选的；省略时沿用 Widget 的同源连接逻辑，也可以继续使用 `connection.baseUrl`。

## 自定义按钮

```ts
const support = LiveSupport.init({ autoButton: false });

document.getElementById('support')?.addEventListener('click', () => {
  support.toggle();
});
```

## 实例方法

- `open()`：打开聊天窗口。
- `close()`：关闭聊天窗口。
- `toggle()`：切换窗口状态。
- `isOpen()`：返回窗口是否打开。
- `destroy()`：关闭连接、卸载 React、移除容器并释放 SDK 监听器。
- `setVisitor(visitor)` / `getVisitor()`：设置或读取当前页面内存中的访客元数据；不会写入数据库，也不会改变 WebSocket 协议。

销毁后可以再次调用 `LiveSupport.init()` 创建新的实例。每次 `init()` 都是独立实例，不会共享事件监听器。

## 事件

```ts
const onMessage = (message) => {
  console.log('收到消息', message);
};
const unsubscribe = support.on('message:received', onMessage);

support.on('open', () => console.log('窗口已打开'));
support.on('connected', () => console.log('已连接'));
support.on('disconnected', () => console.log('已断开'));
support.on('message:sent', (message) => console.log('消息已发送', message));
support.on('error', (error) => console.error('客服组件错误', error));

support.off('message:received', onMessage);
unsubscribe();
```

支持的事件为：`open`、`close`、`connected`、`disconnected`、`message`、`message:sent`、`message:received` 和 `error`。`message` 与 `message:received` 在收到 Worker 的文字或图片消息时触发；`message:sent` 在客户端成功写入 WebSocket 后触发。

## Embed Mode

演示页或嵌入页可以通过 `?embed=1` 自动打开窗口并隐藏浮动按钮：

```text
https://xxxx.pages.dev/?embed=1
```

也可以在容器上设置 `data-embed="true"`：

```html
<main
  id="live-support-widget"
  data-worker-base-url="https://your-worker.workers.dev"
  data-embed="true"
></main>
```

页面初始化后提供 `window.LiveSupport.open()`、`window.LiveSupport.close()` 和 `window.LiveSupport.toggle()`。初始化完成前调用这些方法时，操作会排队并在 Widget 挂载后执行。

## 传统挂载方式

已有项目无需修改：

```ts
import { mountChatWidget } from '@live-support/widget';

const unmount = mountChatWidget(document.getElementById('live-support-widget')!);
// 页面销毁时调用 unmount()。
```
