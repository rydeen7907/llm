/**
 * ファイル解析モジュール
 * 
 * ユーザーが添付した各種ファイルを LLM が理解できるテキスト形式に変換します。
 * PDF の場合は pdf.js を使用してページごとのテキストを抽出し、
 * テキストファイルや Markdown はそのまま読み取ります。
 */
export async function parseFileContent(fileData) {
    if (fileData.type === 'application/pdf') {
        try {
            // pdfjsLib は global (CDN) から取得
            const arrayBuffer = await fileData.obj.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let text = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map(item => item.str).join(" ") + "\n";
            }
            return `\n[PDFファイル "${fileData.name}" の内容]:\n${text}\n`;
        } catch (e) {
            return `\n[PDF "${fileData.name}" の読み込みエラー]\n`;
        }
    } else if (fileData.type.startsWith('text/') || fileData.name.endsWith('.md')) {
        return `\n[ファイル "${fileData.name}" の内容]:\n${await fileData.obj.text()}\n`;
    }
    return "";
}