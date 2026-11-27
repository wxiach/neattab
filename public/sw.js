'use strict';

/* 工具栏图标点击已由 action.default_popup（popup.html）承接，此处仅保留轻量安装钩子。 */
chrome.runtime.onInstalled.addListener(() => {
  /* 首次安装后打开新标签页即可直接使用，不再强制弹设置页 */
});
