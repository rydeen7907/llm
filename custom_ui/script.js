/**
 * アプリケーションのメインロジック（オーケストレーター）
 * 
 * 各モジュール（API, UI, ChatManager, Files等）を統合し、
 * メッセージの送信フロー、アプリの初期化、イベントリスナーの管理を行います。
 * ユーザーの操作をきっかけに、データの処理と表示の更新を制御します。
 */

import { sendChatRequest, getModels, getHealth, getProps } from './api.js';
import { addMessage, renderPreviews, renderChatList, showToast, getBotIcon, showTypingIndicator, hideTypingIndicator } from './ui.js';
import { parseFileContent } from './files.js';
import { downloadJSON, readJSONFile, encryptData, decryptData } from './backup.js';
import { ChatManager } from './ChatManager.js';
import { UIManager } from './UIManager.js';
import { systemPresets, presetLabels, DEFAULT_SYSTEM_PROMPT, STORAGE_LIMIT, MAX_SYSTEM_PROMPT_LENGTH, MAX_USER_INPUT_LENGTH, CONTINUE_LABEL } from './constants.js';

// PDF.jsのワーカー設定
if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// マネージャーのインスタンス化
const chatManager = new ChatManager();
const ui = new UIManager();

/**
 * アプリケーションの実行時状態
 * 添付ファイルのバッファや、リクエスト中断のための AbortController を保持します。
 */
const sessionState = {
    attachedFiles: [],
    abortController: null,
    serverProps: null // サーバーのコンテキストサイズなどを保持
};

/**
 * アプリケーションの初期化
 */
async function initApp() {
    try {
        // 1. データベースからチャット履歴と設定を読み込み
        const currentChat = await chatManager.loadAll();

        // 1.5 サーバーのプロパティを取得 (n_ctxなど)
        sessionState.serverProps = await getProps();

        // 2. ブラウザの保存領域(localStorage)から見た目の設定を復元
        loadGlobalSettings();

        // 3. 画面の初期レンダリング
        ui.setContinueHandler(handleContinue);
        ui.renderChat(currentChat, chatManager.chats);
        ui.renderPresets(systemPresets, chatManager.customPresets, presetLabels);
        ui.updateStorageMeter(chatManager.chats, STORAGE_LIMIT);
        
        // 3.5 設定画面のリアクティブな連動を開始
        ui.initSettingsReactivity((id, val) => {
            // チャット個別設定のリスト
            const chatSettings = ['system_prompt', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens'];
            
            if (chatSettings.includes(id)) {
                // アクティブなチャットの設定を更新
                if (id === 'system_prompt') {
                    chatManager.updateSystemPrompt(val);
                } else {
                    chatManager.currentChat.settings[id] = val;
                    chatManager.saveCurrent();
                    if (id === 'max_tokens') {
                        ui.updateUserInputCounter(ui.el.userInput.value, getDynamicInputLimit());
                    }
                }
            } else {
                // グローバル設定（壁紙、テーマ、通知時間など）を保存
                localStorage.setItem(`global_${id}`, val);
                ui.updateStorageMeter(chatManager.chats, STORAGE_LIMIT);
            }
        });

        // 4. サーバー状態の監視開始
        updateModelInfo();
        updateStatus();
        setInterval(updateStatus, 3000);

        // 入力監視の開始
        ui.el.userInput.oninput = (e) => ui.updateUserInputCounter(e.target.value, getDynamicInputLimit());

        ui.el.userInput.focus();
    } catch (e) {
        console.error('初期化エラー:', e);
        showToast('データの読み込みに失敗しました', 'error');
    }
}

/**
 * 現在の状況に応じた動的な入力リミット（トークン単位）を算出する
 */
function getDynamicInputLimit() {
    // 1. チャット固有の "最大トークン数" 設定がある場合
    const settingsMax = parseInt(chatManager.currentChat?.settings?.max_tokens);
    if (settingsMax > 0) return settingsMax;

    // 2. 設定が -1 (無制限) の場合、サーバーのコンテキストサイズをリミットにする
    if (sessionState.serverProps?.default_generation_settings?.n_ctx) {
        return sessionState.serverProps.default_generation_settings.n_ctx;
    }

    return MAX_USER_INPUT_LENGTH * 1.1; // どちらも不明な場合は定数から逆算
}

/**
 * グローバルな見た目設定の読み込みと適用
 */
// localStorage に保存されているユーザー設定（壁紙、色、通知設定）を UI クラスを通じて適用します
function loadGlobalSettings() {
    ui.updateSetting('theme_color', localStorage.getItem('global_theme_color') || '#0084ff');

    const savedWallpaper = localStorage.getItem('global_wallpaper');
    if (savedWallpaper) {
        ui.applyWallpaper(savedWallpaper);
        if (!savedWallpaper.startsWith('data:') && ui.el.inputWallpaperUrl) ui.el.inputWallpaperUrl.value = savedWallpaper;
    }

    ui.updateSetting('wallpaper_opacity', localStorage.getItem('global_wallpaper_opacity') || '0.15');
    ui.updateSetting('wallpaper_blur', localStorage.getItem('global_wallpaper_blur') || '0');
    ui.updateSetting('wallpaper_fit', localStorage.getItem('global_wallpaper_fit') || 'cover');
    ui.updateSetting('toast_duration', localStorage.getItem('global_toast_duration') || '4');
}

// --- ビジネスロジック ---

/**
 * メッセージ送信の主処理
 * 入力内容のバリデーション、ファイル解析、AIへのリクエスト、結果の保存と表示を一貫して行います。
 */
async function sendMessage() {
    const text = ui.el.userInput.value.trim();
    if (!text && sessionState.attachedFiles.length === 0) return;

    const currentFiles = [...sessionState.attachedFiles];
    sessionState.attachedFiles = [];
    renderPreviews(ui.el.filePreview, sessionState.attachedFiles);
    
    ui.el.userInput.value = '';
    ui.updateUserInputCounter('', getDynamicInputLimit()); // カウンターをリセット
    ui.setUIState(false);

    // システムプロンプトの文字数が多すぎると推論に影響が出るため、警告を表示
    if (ui.el.systemInput.value.length > MAX_SYSTEM_PROMPT_LENGTH) {
        showToast('システムプロンプトが長すぎます。回答の質が低下する可能性があります。', 'warning');
    }

    try {
        // ファイル解析
        const { messageContent, fullText, imagePreviews, fileTexts } = await processFiles(currentFiles, text);
        
        // ユーザーメッセージの表示と保存
        addMessage(ui.el.chatContainer, { text, isUser: true, icon: '👤', images: imagePreviews, fileTexts });
        chatManager.addHistory('user', messageContent.length > 1 ? messageContent : fullText, '👤');

        // 初回メッセージでのタイトル更新
        if (chatManager.currentChat.history.length === 1) {
            chatManager.updateTitle(text);
            renderChatList(ui.el.chatListContainer, chatManager.chats, chatManager.currentChatId);
        }
        
        await chatManager.saveCurrent();
        sessionState.abortController = new AbortController();

        // インジケーターの表示
        const botIcon = getBotIcon(ui.el.presetSelect.value);
        showTypingIndicator(ui.el.chatContainer, botIcon);

        // システムプロンプトを含むリクエストの構築
        const requestMessages = ui.el.systemInput.value 
            ? [{ role: 'system', content: ui.el.systemInput.value }, ...chatManager.currentChat.history] 
            : chatManager.currentChat.history;

        const startTime = performance.now();
        const data = await sendChatRequest(requestMessages, sessionState.abortController.signal, chatManager.currentChat.settings);
        const endTime = performance.now();
        
        const generationTime = ((endTime - startTime) / 1000).toFixed(2);

        hideTypingIndicator(); // 回答が来たら消す

        const botReply = data.choices[0].message.content;

        // AI回答の保存と表示
        chatManager.addHistory('assistant', botReply, botIcon);
        
        // 1往復完了時にAIタイトル生成を試行
        if (chatManager.currentChat.history.length === 2) {
            generateAiTitle(chatManager.currentChat, text, botReply);
        }

        const totalTokens = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
        const limit = getDynamicInputLimit();

        const metadata = {
            charCount: botReply.length,
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            time: generationTime,
            isOverLimit: totalTokens >= limit,
            onContinue: handleContinue
        };

        // 履歴にメタデータを含めて保存
        const lastIndex = chatManager.currentChat.history.length - 1;
        chatManager.currentChat.history[lastIndex].metadata = metadata;
        await chatManager.saveCurrent();

        addMessage(ui.el.chatContainer, { text: botReply, isUser: false, icon: botIcon, metadata });
        ui.updateStorageMeter(chatManager.chats, STORAGE_LIMIT);

    } catch (e) {
        hideTypingIndicator(); // エラー時も消す
        const errorMsg = e.name === 'AbortError' ? '生成を中断しました。' : `エラー: ${e.message}`;
        addMessage(ui.el.chatContainer, { text: errorMsg, isUser: false, icon: '⚠️' });
    } finally {
        sessionState.abortController = null;
        ui.setUIState(true);
        ui.el.userInput.focus();
    }
}

/**
 * 途切れたメッセージの続きを生成する
 */
async function handleContinue() {
    const chat = chatManager.currentChat;
    if (!chat || chat.history.length === 0) return;

    ui.setUIState(false);
    const botIcon = getBotIcon(ui.el.presetSelect.value);
    showTypingIndicator(ui.el.chatContainer, botIcon);

    try {
        sessionState.abortController = new AbortController();
        
        // 「続きを書いて」という指示を内部的に追加してリクエスト
        const historyForContinue = [...chat.history];
        historyForContinue.push({ role: 'user', content: '続きを生成してください。余計な解説は不要です。' });

        const requestMessages = ui.el.systemInput.value 
            ? [{ role: 'system', content: ui.el.systemInput.value }, ...historyForContinue] 
            : historyForContinue;

        const startTime = performance.now();
        const data = await sendChatRequest(requestMessages, sessionState.abortController.signal, chat.settings);
        const endTime = performance.now();
        const generationTime = ((endTime - startTime) / 1000).toFixed(2);

        hideTypingIndicator();

        const additionalText = data.choices[0].message.content;
        const lastMsg = chat.history[chat.history.length - 1];

        // 既存のメッセージ末尾に結合
        if (lastMsg.role === 'assistant') {
            const divider = `\n\n<div class="continue-divider" data-label="${CONTINUE_LABEL}"></div>\n\n`;
            lastMsg.content += divider + additionalText;
            
            const totalTokens = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
            const limit = getDynamicInputLimit();
            
            lastMsg.metadata = {
                charCount: lastMsg.content.length,
                promptTokens: data.usage?.prompt_tokens,
                completionTokens: data.usage?.completion_tokens,
                time: generationTime,
                isOverLimit: totalTokens >= limit
            };
        }

        await chatManager.saveCurrent();
        ui.renderChat(chat, chatManager.chats);

    } catch (e) {
        showToast('続きの生成に失敗しました', 'error');
    } finally {
        ui.setUIState(true);
    }
}

/**
 * 添付ファイルの解析処理
 */
async function processFiles(files, baseText) {
    const fileTexts = [];
    const imagePreviews = [];
    const messageContent = [];
    let fullText = baseText;

    for (const f of files) {
        if (f.type.startsWith('image/')) {
            imagePreviews.push(f.preview);
            messageContent.push({ type: "image_url", image_url: { url: f.preview } });
        } else {
            const content = await parseFileContent(f);
            if (content) { fileTexts.push(content); fullText += content; }
        }
    }
    messageContent.unshift({ type: "text", text: fullText });
    return { messageContent, fullText, imagePreviews, fileTexts };
}

/**
 * メッセージ内容（文字列または画像を含む配列）から純粋なテキストを抽出
 */
function parseMessageContent(content) {
    if (typeof content === 'string') return { text: content };
    let text = '';
    if (Array.isArray(content)) {
        content.forEach(p => {
            if (p.type === 'text') text += p.text;
        });
    }
    return { text };
}

/**
 * 長すぎる入力文をAIに依頼して短縮する
 */
async function requestShortenSuggestion() {
    const text = ui.el.userInput.value;
    const limit = getDynamicInputLimit();
    const charLimit = Math.floor(limit / 1.1);

    if (text.length <= charLimit) return;

    ui.el.shortenBtn.textContent = '⌛ 短縮中...';
    ui.el.shortenBtn.style.pointerEvents = 'none';
    ui.el.shortenBtn.classList.add('pulse');

    try {
        const data = await sendChatRequest([
            { 
                role: 'system', 
                content: `あなたは優秀な編集者です。以下の文章を、意味を保ったまま文字数を減らして要約してください。目標文字数は ${charLimit} 文字以内です。解説などは一切不要です。要約した文章のみを出力してください。` 
            },
            { role: 'user', content: text }
        ]);

        const shortened = data.choices[0].message.content.trim();
        if (shortened) {
            ui.el.userInput.value = shortened;
            // カウンターを再計算
            ui.updateUserInputCounter(shortened, limit);
            showToast('文章を要約して最適化しました');
        }
    } catch (e) {
        showToast('要約に失敗しました', 'error');
    } finally {
        ui.el.shortenBtn.textContent = 'AIに短縮を依頼';
        ui.el.shortenBtn.style.pointerEvents = 'auto';
        ui.el.shortenBtn.classList.remove('pulse');
    }
}

/**
 * AIを使用したチャットタイトルの自動生成
 * 会話の1往復が終わったタイミングで、内容を要約した短いタイトルを生成します。
 */
async function generateAiTitle(chat, userMsg, botReply) {
    // サイドバーの対象アイテムを取得して視覚的なフィードバックを開始
    const item = ui.el.chatListContainer.querySelector(`.chat-item[data-id="${chat.id}"]`);
    const nameSpan = item?.querySelector('.chat-name');
    const regenIcon = item?.querySelector('.regenerate-chat');

    if (nameSpan) nameSpan.classList.add('pulse');
    if (regenIcon) regenIcon.classList.add('spinning');

    try {
        const data = await sendChatRequest([
            { role: 'system', content: 'あなたは優秀なコンテンツ編集者です。ユーザーとAIの対話から、その核心を突く簡潔で魅力的な日本語のタイトルを20文字以内で作成してください。制約事項：接頭辞（例：タイトル：、題名：）や装飾記号（例：「」、・）は一切含めず、タイトル文字列のみを出力すること。日本語以外の言語は使用禁止。' },
            { role: 'user', content: `【対話内容】\nユーザー: ${userMsg}\nアシスタント: ${botReply}\n\nタイトル:` }
        ]);
        const aiTitle = data.choices[0].message.content.trim().replace(/^(タイトル|要約|題名|Title|Summary)[:：\s]*/i, '').replace(/["「」『』\n]/g, '').substring(0, 20);
        if (aiTitle) {
            chat.name = aiTitle;
            await chatManager.saveChat(chat);
        }
    } catch (e) { 
        console.error('Title generation failed', e); 
    } finally {
        // 成功・失敗に関わらず再描画してアニメーション状態をリセットする
        renderChatList(ui.el.chatListContainer, chatManager.chats, chatManager.currentChatId);
    }
}

// --- UI更新ヘルパー ---

/**
 * サーバーから使用中のモデル名を取得し表示
 */
async function updateModelInfo() {
    try {
        const data = await getModels();
        if (data.data?.length > 0) {
            ui.el.modelDisplay.textContent = `(${data.data[0].id.split('/').pop()})`;
        }
    } catch (e) { ui.el.modelDisplay.textContent = ''; }
}

/**
 * サーバーの稼働状況（リソース使用量、アイドル状態）を定期監視
 */
async function updateStatus() {
    try {
        const data = await getHealth();
        const isReady = data.status === 'ok';
        const isBusy = data.slots_processing > 0;

        ui.el.statusIndicator.textContent = !isReady ? '● Loading...' : (isBusy ? '● Busy' : '● Ready');
        ui.el.statusIndicator.style.color = !isReady || isBusy ? '#f0ad4e' : '#42b983';
        ui.el.statusIndicator.classList.toggle('pulse', isBusy);

        if (isReady && data.slots_idle !== undefined) {
            ui.el.resourceDisplay.textContent = `Slots: ${data.slots_idle}/${data.slots_idle + data.slots_processing}`;
        }
    } catch (e) {
        ui.el.statusIndicator.textContent = '● Offline';
        ui.el.statusIndicator.style.color = '#d9534f';
        ui.el.statusIndicator.classList.remove('pulse');
    }
}

// --- イベントリスナー ---

// 各ボタンのクリックや入力操作に対して、適切なロジックを結びつけます

// サーバー停止ボタン
if (ui.el.serverStopBtn) ui.el.serverStopBtn.onclick = () => {
// ... 以下省略
    if (confirm('アプリとサーバーを終了しますか？')) {
        terminateApp();
        showToast('サーバー終了リクエストを送信しました。', 'info');
        setTimeout(() => {
            window.location.href = "about:blank";
        }, 200);
    }
};

// 送信ボタン：生成中なら「中断」、待機中なら「送信」
if (ui.el.sendBtn) ui.el.sendBtn.onclick = () => sessionState.abortController ? sessionState.abortController.abort() : sendMessage();

// 短縮提案ボタン：クリック時にAIによる要約を実行
if (ui.el.shortenBtn) ui.el.shortenBtn.onclick = requestShortenSuggestion;

// 入力欄でのEnterキー：Shiftなしなら送信を実行
if (ui.el.userInput) ui.el.userInput.onkeypress = (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage());

// 新規チャットボタン
if (ui.el.newChatBtn) ui.el.newChatBtn.onclick = async () => {
    const newChat = await chatManager.createNewChat();
    ui.renderChat(newChat, chatManager.chats);
};

// チャットリスト（サイドバー）内のクリックイベント
if (ui.el.chatListContainer) ui.el.chatListContainer.onclick = async (e) => {
    const id = e.target.dataset.id || e.target.parentElement.dataset.id;
    if (!id) return;

    // 削除アイコン（×）が押された場合
    if (e.target.classList.contains('delete-chat')) {
        if (confirm('削除しますか？')) {
            const current = await chatManager.deleteChat(id);
            ui.renderChat(current, chatManager.chats);
        }
    // 編集アイコン（✎）が押された場合
    } else if (e.target.classList.contains('edit-chat')) {
        const chat = chatManager.chats.find(c => c.id === id);
        const n = prompt('名前を変更:', chat.name);
        if (n?.trim()) {
            chat.name = n.trim();
            await chatManager.saveChat(chat);
            renderChatList(ui.el.chatListContainer, chatManager.chats, chatManager.currentChatId);
        }
    // 再生成アイコン（↻）が押された場合
    } else if (e.target.classList.contains('regenerate-chat')) {
        const chat = chatManager.chats.find(c => c.id === id);
        if (chat && chat.history.length >= 2) {
            // メッセージが構造化データ（画像等を含む）の場合でもテキストを抽出して渡す
            const { text: uText } = parseMessageContent(chat.history[0].content);
            const { text: bText } = parseMessageContent(chat.history[1].content);
            generateAiTitle(chat, uText, bText);
        }
    // チャット項目自体が押された場合（切り替え）
    } else {
        const chat = await chatManager.switchChat(id);
        ui.renderChat(chat, chatManager.chats);
        ui.updateUserInputCounter(ui.el.userInput.value, getDynamicInputLimit());
    }
};

// バックアップの書き出しボタン
if (ui.el.exportBtn) ui.el.exportBtn.onclick = async () => {
    let data = await chatManager.getFullBackupData();
    const date = new Date().toISOString().split('T')[0];
    
    const password = prompt('バックアップを保護するパスワードを入力してください（空欄の場合は暗号化されません）:');
    if (password) {
        try {
            data = await encryptData(data, password);
            showToast('データを暗号化して書き出しました');
        } catch (e) {
            showToast('暗号化に失敗しました', 'error');
            return;
        }
    } else {
        showToast('データを書き出しました');
    }

    downloadJSON(data, `llm-chat-backup-${date}.json`);
};

// 復元ボタン：ファイル選択ダイアログを開く
if (ui.el.importBtn && ui.el.importFile) ui.el.importBtn.onclick = () => ui.el.importFile.click();

// 復元ファイルが選択された時の処理
if (ui.el.importFile) ui.el.importFile.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('データを復元しますか？現在のデータはすべて上書きされます。')) return;

    try {
        let data = await readJSONFile(file);

        // 暗号化されている場合のチェック
        if (data.encrypted && data.ciphertext) {
            const password = prompt('このバックアップは暗号化されています。パスワードを入力してください:');
            if (!password) {
                showToast('復号にはパスワードが必要です', 'warning');
                return;
            }
            try {
                data = await decryptData(data, password);
            } catch (err) {
                showToast('復号に失敗しました。パスワードが間違っている可能性があります。', 'error');
                return;
            }
        }

        await chatManager.restoreFullBackup(data);
        showToast('復元が完了しました。ページを再読み込みします。', 'info');
        setTimeout(() => location.reload(), 1500);
    } catch (err) {
        showToast(err.message, 'error');
    }
};

// ファイル添付ボタン
if (ui.el.attachBtn && ui.el.fileInput) ui.el.attachBtn.onclick = () => ui.el.fileInput.click();

// ファイルが選択された時の解析とバッファへの追加
if (ui.el.fileInput) ui.el.fileInput.onchange = async (e) => {
    for (const file of e.target.files) {
        if (sessionState.attachedFiles.length >= 5) break;
        const fileData = { name: file.name, type: file.type, obj: file };
        if (file.type.startsWith('image/')) {
            fileData.preview = await new Promise(r => {
                const reader = new FileReader();
                reader.onload = ev => r(ev.target.result);
                reader.readAsDataURL(file);
            });
        }
        sessionState.attachedFiles.push(fileData);
    }
    renderPreviews(ui.el.filePreview, sessionState.attachedFiles);
    ui.el.fileInput.value = '';
};

// 設定パネル系
if (ui.el.settingsBtn && ui.el.settingsModal) ui.el.settingsBtn.onclick = () => ui.el.settingsModal.showModal();
if (ui.el.closeSettingsBtn && ui.el.settingsModal) ui.el.closeSettingsBtn.onclick = () => ui.el.settingsModal.close();

// モーダルの外側（背景）クリックで閉じる機能
if (ui.el.settingsModal) ui.el.settingsModal.addEventListener('click', (e) => {
    const rect = ui.el.settingsModal.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        ui.el.settingsModal.close();
    }
});

// Escキーで設定モーダルを閉じる
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.el.settingsModal.open) ui.el.settingsModal.close();
});

if (ui.el.savePresetBtn) ui.el.savePresetBtn.onclick = () => {
    if (ui.el.systemInput.value.length > MAX_SYSTEM_PROMPT_LENGTH) {
        showToast('システムプロンプトが上限を超えているため、保存できません。', 'error');
        return;
    }
    const name = ui.el.customPresetName.value.trim();
    if (!name) {
        showToast('テンプレート名を入力してください', 'warning');
        return;
    }
    chatManager.saveCurrentSystemPromptAsTemplate(name);
    ui.renderPresets(systemPresets, chatManager.customPresets, presetLabels);
    ui.el.customPresetName.value = '';
    showToast(`テンプレート「${name}」を保存しました`);
};

// 古い画像の削除（ストレージ確保）ボタン
if (ui.el.cleanupFilesBtn) ui.el.cleanupFilesBtn.onclick = async () => {
    if (!confirm('現在のチャット以外の履歴から画像データを削除して、容量を確保しますか？\n(テキストの会話内容は維持されます)')) return;

    const result = await chatManager.cleanupOldImages();
    
    if (result.imageCount > 0) {
        const sizeStr = result.clearedBytes > 1024 * 1024 
            ? (result.clearedBytes / (1024 * 1024)).toFixed(2) + 'MB' 
            : (result.clearedBytes / 1024).toFixed(1) + 'KB';
        showToast(`${result.imageCount}枚の画像を削除し、約${sizeStr}の容量を削減しました。`, 'info');
        ui.updateStorageMeter(chatManager.chats, STORAGE_LIMIT);
    } else {
        showToast('削除対象の画像は見つかりませんでした。', 'info');
    }
};

// プリセット選択が変更された時の自動入力
if (ui.el.presetSelect) ui.el.presetSelect.onchange = (e) => {
    const val = e.target.value;
    let promptText = "";
    
    if (val.startsWith('custom:')) {
        const name = val.replace('custom:', '');
        promptText = chatManager.customPresets[name];
    } else if (systemPresets[val]) {
        promptText = systemPresets[val];
    }

    if (promptText) {
        ui.updateSetting('system_prompt', promptText);
        chatManager.updateSystemPrompt(promptText);
    }
};

// 壁紙URLが直接入力された時の反映
if (ui.el.inputWallpaperUrl) ui.el.inputWallpaperUrl.onchange = (e) => {
    const val = e.target.value.trim();
    if (val) { localStorage.setItem('global_wallpaper', val); ui.applyWallpaper(val); }
};

// 壁紙解除ボタン
if (ui.el.resetWallpaperBtn) ui.el.resetWallpaperBtn.onclick = () => {
    localStorage.removeItem('global_wallpaper');
    if (ui.el.inputWallpaperUrl) ui.el.inputWallpaperUrl.value = '';
    ui.applyWallpaper(null);
};

if (ui.el.clearBtn) ui.el.clearBtn.onclick = async () => {
    if (confirm('履歴をクリアしますか？')) {
        chatManager.currentChat.history = [];
        await chatManager.saveCurrent();
        ui.renderChat(chatManager.currentChat, chatManager.chats);
    }
};

// --- アプリケーション終了の処理 ---

function terminateApp() {
    // サイドカーAPIに終了信号を送信 (Beacon APIを使用することで、ブラウザを閉じた後でも送信が保証されます)
    navigator.sendBeacon('http://127.0.0.1:5001/shutdown');
}

// ウィンドウが閉じられるときに実行
window.addEventListener('beforeunload', terminateApp);

window.onload = initApp;
