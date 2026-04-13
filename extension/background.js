/**
 * background.js — Serverless Background Script
 */

const STORAGE_KEY_DEFERRED = 'tab_out_deferred';

async function updateBadge() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_DEFERRED);
    const deferred = data[STORAGE_KEY_DEFERRED] || { active: [], archived: [] };
    const count = deferred.active.length;

    if (count === 0) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    chrome.action.setBadgeText({ text: String(count) });

    let badgeColor;
    if (count <= 3) badgeColor = '#3d7a4a';
    else if (count <= 6) badgeColor = '#b8892e';
    else badgeColor = '#b35a5a';

    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateBadge') updateBadge();
});

setInterval(updateBadge, 60 * 1000);
updateBadge();
