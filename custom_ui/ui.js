/**
 * 画面部品（UIコンポーネント）生成モジュール
 * 
 * メッセージバブルの作成、Markdown のパース、トースト通知の表示など、
 * 再利用可能な HTML 要素を動的に生成して画面に挿入する純粋な描画処理を担います。
 * 状態管理は行わず、受け取ったデータに基づいたレンダリングに特化しています。
 */

import { presetIcons } from './constants.js';

/**
 * チャットメッセージを画面に追加する
 */
export function addMessage(container, { text, isUser, icon, images = [], fileTexts = [], metadata = null }) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isUser ? 'user' : 'bot'}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = icon || (isUser ? '👤' : '🤖');
    wrapper.appendChild(avatar);

    const div = document.createElement('div');
    div.className = 'message';
    
    if (text) {
        const textDiv = document.createElement('div');
        if (isUser) {
            textDiv.textContent = text;
        } else {
            // AIの回答はMarkdownとしてパースし、コードハイライトを適用
            if (typeof marked !== 'undefined') {
                textDiv.innerHTML = marked.parse(text);
                if (typeof hljs !== 'undefined') {
                    textDiv.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }
            } else {
                textDiv.textContent = text;
            }
        }
        div.appendChild(textDiv);
    }

    fileTexts.forEach(content => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file-content';
        
        const maxLength = 500;
        if (content.length > maxLength) {
            const previewText = content.substring(0, maxLength) + '...';
            const textSpan = document.createElement('span');
            textSpan.textContent = previewText;
            
            const btn = document.createElement('button');
            btn.className = 'toggle-file-btn';
            btn.textContent = 'もっと見る';
            btn.onclick = () => {
                const isExpanded = btn.textContent === '閉じる';
                textSpan.textContent = isExpanded ? previewText : content;
                btn.textContent = isExpanded ? 'もっと見る' : '閉じる';
            };
            fileDiv.appendChild(textSpan);
            fileDiv.appendChild(btn);
        } else {
            fileDiv.textContent = content;
        }
        div.appendChild(fileDiv);
    });

    images.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        div.appendChild(img);
    });

    // メタデータ（トークン数や生成時間）の表示
    if (metadata) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-metadata';
        if (metadata.isOverLimit) {
            metaDiv.classList.add('warning');
            const continueBtn = document.createElement('button');
            continueBtn.className = 'continue-btn';
            continueBtn.textContent = '続きを生成';
            continueBtn.onclick = () => {
                continueBtn.remove(); // 二重クリック防止のため即座に削除
                if (metadata.onContinue) metadata.onContinue();
            };
            metaDiv.appendChild(continueBtn);
        }
        const parts = [];
        if (metadata.time) parts.push(`${metadata.time}s`);
        if (metadata.charCount) parts.push(`${metadata.charCount}文字`);
        if (metadata.promptTokens) parts.push(`P:${metadata.promptTokens}t`);
        if (metadata.completionTokens) parts.push(`C:${metadata.completionTokens}t`);
        metaDiv.textContent = parts.join(' | ');
        div.appendChild(metaDiv);
    }

    // AIのメッセージにコピーボタンを追加
    if (!isUser && text) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'コピー';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = '完了!';
                setTimeout(() => copyBtn.textContent = 'コピー', 2000);
            });
        };
        div.appendChild(copyBtn);
    }

    wrapper.appendChild(div);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

/**
 * タイピング中（考え中）のインジケーターを表示する
 */
export function showTypingIndicator(container, icon = "🤖") {
    const wrapper = document.createElement('div');
    wrapper.id = 'typing-indicator';
    wrapper.className = 'message-wrapper bot';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = icon;
    wrapper.appendChild(avatar);

    const div = document.createElement('div');
    div.className = 'message thinking';
    div.textContent = '考え中...';
    wrapper.appendChild(div);

    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

/**
 * タイピング中のインジケーターを削除する
 */
export function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

/**
 * 添付ファイルのプレビューをレンダリングする
 */
export function renderPreviews(container, files, onRemove) {
    container.innerHTML = files.map((f, i) => `
        <div class="preview-item">
            ${f.preview ? `<img src="${f.preview}">` : `<span>${f.name.split('.').pop().toUpperCase()}</span>`}
            <button class="remove-btn" data-index="${i}">×</button>
        </div>
    `).join('');
}

/**
 * チャットリスト（サイドバー）をレンダリングする
 */
export function renderChatList(container, chats, currentChatId) {
    container.innerHTML = chats.map(chat => `
        <div class="chat-item ${chat.id === currentChatId ? 'active' : ''}" data-id="${chat.id}">
            <span class="chat-name">${chat.name}</span>
            <div class="chat-actions">
                <span class="regenerate-chat" data-id="${chat.id}" title="タイトルを再生成">↻</span>
                <span class="edit-chat" data-id="${chat.id}" title="名前を変更">✎</span>
                <span class="delete-chat" data-id="${chat.id}" title="削除">×</span>
            </div>
        </div>
    `).join('');
}

/**
 * 通知トーストを表示する
 */
export function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

/**
 * 現在のプリセットに基づいたアイコンを取得
 */
export function getBotIcon(presetValue) {
    return presetIcons[presetValue] || "🤖";
}