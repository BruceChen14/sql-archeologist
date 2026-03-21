import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'; 
  
  // 💡 本地測試請確保 Ollama 已啟動並設定 OLLAMA_ORIGINS="*"
  //private localOllamaUrl = 'http://localhost:11434/api/generate';
  private localOllamaUrl = 'https://unmultiplicable-kelsey-unclearable.ngrok-free.dev/api/generate';

  usageCount = signal(Number(localStorage.getItem('DAILY_USAGE')) || 0);

  /**
   * 核心進入點：會根據 apiKey 是否為 "ollama" 自動切換引擎
   */
  async analyzeSql(sql: string, apiKey: string, mode: string, testValues?: string): Promise<string> {
    
    // 🛠️ 內部 Helper：定義嚴格的 JSON 輸出格式
    const getJsonInstruction = (isTrace: boolean) => `
### 🚨 機器讀取區：JSON DATA STRUCTURE (STRICT)
你必須在回覆的最末端，提供包裹在 [MAP_START] 與 [MAP_END] 之間的 JSON 陣列。
1. JSON 欄位名稱禁止使用中文。
2. "summary", "desc", "impact" 必須使用【繁體中文】。
3. ${isTrace ? '"vars" 陣列必須包含根據啟動參數計算出的真實數值（如 v_amt: 105）。' : '"steps" 保持為空陣列。'}

[MAP_START]
[
  { 
    "name": "PROC_NAME", 
    "type": "PROCEDURE", 
    "summary": "程序業務摘要", 
    "calls": [],
    "steps": ${isTrace ? `[
      {
        "label": "步驟標籤",
        "desc": "動作描述",
        "line": 1,
        "anchor": "代碼關鍵字", 
        "vars": [{ "name": "變數名", "value": "演算值" }],
        "impact": "數據演變與判斷細節"
      }
    ]` : '[]'}
  }
]
[MAP_END]`;

    // 🧠 模式 1：🚀 效能與重構診斷
    const debugPrompt = `你是一位精通 Oracle 底層的資深優化專家。請針對以下 SQL 進行診斷：
### 🚨 1. 關鍵風險 (繁體中文回覆)
- 找出 NULL 陷阱、異常處理黑洞或潛在資料遺失點。
### 🔄 2. 效能優化
- 指出索引失效、全表掃描或可改進的批量處理。
### 🧪 3. 重構建議
- 提供更現代、簡潔的 SQL 寫法。

${getJsonInstruction(false)}
待處理程式碼：\n${sql}`;

    // 🧠 模式 2：📜 業務通靈與影響評估
    const docPrompt = `你是一位擁有 30 年經驗的「數位考古偵探」。請進行「動機通靈」：
### 📝 1. 核心意圖
- 推測當初為何這樣設計？隱藏了什麼特殊業務潛規則？
### 🗄️ 2. 資料異動影響
- 列出異動的 Table 及其商業目的（例如：對帳、備份、觸發 Job）。
### ⚠️ 3. 斷捨離評估
- 如果停掉這段邏輯，最嚴重的後果是什麼？

${getJsonInstruction(false)}
待解析程式碼：\n${sql}`;

    // 🧠 模式 3：🧩 虛擬偵錯 (數據演變核心)
    const tracePrompt = `你現在是 Oracle 虛擬偵錯引擎 (Traditional Chinese Mode)。
請嚴格遵守【先分析報告，後 JSON 地圖】的格式，嚴禁使用簡體字。

---
### 🖥️ 第一階段：逐行偵錯報告
1. **執行路徑**：根據啟動參數【${testValues || '預設值'}】，說明程式會進入哪些 IF/CASE 分支。
2. **數據演算細節**：
   - 必須像 Debugger 一樣列出每一行執行後的數據變化。
   - 例如：輸入 id=888，經過計算後 v_tax 變成 6000。
3. **判斷結果**：說明 IF 條件是否成立，以及原因。

---
### ⚙️ 第二階段：結構化執行地圖
${getJsonInstruction(true)}

待偵錯程式碼：\n${sql}`;

    let finalPrompt = '';
    if (mode === 'debug') finalPrompt = debugPrompt;
    else if (mode === 'document') finalPrompt = docPrompt;
    else finalPrompt = tracePrompt;

    if (apiKey.toLowerCase() === 'ollama') {
      return this.analyzeWithLocalOllama(finalPrompt);
    } else {
      return this.analyzeWithGemini(finalPrompt, apiKey);
    }
  }

  private async analyzeWithLocalOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(this.localOllamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5-coder:7b',
          prompt: prompt,
          stream: false,
          options: {
            num_ctx: 16384,     // 平衡 5060 顯存與長度
            num_predict: -1,    // 確保 JSON 不會斷頭
            temperature: 0.1,   // 降低隨機性
            main_gpu: 0         // 強制 5060
          }
        }),
      });

      if (!response.ok) throw new Error('地端顯卡拒絕連線，請檢查 Ollama 是否啟動');
      const data = await response.json();
      return this.cleanAiResponse(data.response);
    } catch (error) {
      throw new Error('考古連線失敗：' + error);
    }
  }

  private async analyzeWithGemini(prompt: string, apiKey: string): Promise<string> {
    const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) throw new Error('Gemini API 錯誤');
    const data = await response.json();
    this.updateUsage();
    return data.candidates[0].content.parts[0].text;
  }

  private cleanAiResponse(raw: string): string {
    return raw.replace(/```json/g, '').replace(/```sql/g, '').replace(/```/g, '').trim();
  }

  private updateUsage() {
    const next = this.usageCount() + 1;
    this.usageCount.set(next);
    localStorage.setItem('DAILY_USAGE', next.toString());
  }
}