import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  // 🌟 雲端 Gemini API 配置 (保持你原本的設定)
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'; 
  
  // 🏠 地端 Ollama API 配置 (指向你剛才測試成功的 11434 埠)
  //private localOllamaUrl = 'http://localhost:11434/api/generate';
  private localOllamaUrl = 'https://unmultiplicable-kelsey-unclearable.ngrok-free.dev';

  usageCount = signal(Number(localStorage.getItem('DAILY_USAGE')) || 0);

  /**
   * 核心進入點：會根據 apiKey 是否為 "ollama" 自動切換引擎
   */
  async analyzeSql(sql: string, apiKey: string, mode: string): Promise<string> {
    
    // 🛠️ 內部 Helper：產出一致的 JSON 地圖指令 (完整保留你原本的邏輯)
    const getJsonInstruction = (isTrace: boolean) => `
### 🚨 重要：請在回覆的最末端，附加一個包裹在 [MAP_START] 與 [MAP_END] 之間的 JSON。
1. 找出所有本地定義的 PROCEDURE 與 FUNCTION。
2. **外部依賴偵測**：若發現代碼呼叫了外部 Package (PKG.PROC)，請標註 "type": "EXTERNAL"。
${isTrace ? `3. **核心任務 (Trace Mode)**：請為每個程序拆解執行步驟。
    - 必須包含 **"vars"** 陣列：預測該步驟關鍵變數的值。
    - 必須包含 **"branch"** 欄位：若為判斷式(IF/CASE)，請寫出條件，否則留空。
    - 必須包含 **"anchor"** 欄位：該步驟對應的「原始碼關鍵片段」(約 15-20 字)，請直接從原文中複製，這將作為搜尋錨點。` : '3. "steps" 欄位請保持為空陣列 []。'}

[MAP_START]
[
  { 
    "name": "名稱", 
    "type": "PROCEDURE / FUNCTION / EXTERNAL", 
    "summary": "摘要", 
    "calls": ["子程式"],
    "steps": ${isTrace ? `[
      {
        "label": "[SQL]",
        "desc": "檢查訂單狀態",
        "line": 120,
        "anchor": "IF v_status = '9' THEN", 
        "branch": "IF v_status = '9'",
        "vars": [
          { "name": "v_status", "value": "'9'" }
        ],
        "impact": "進入核准流程"
      }
    ]` : '[]'}
  }
]
[MAP_END]`;

    // 🧠 模式 1：救火診斷
    const debugPrompt = `你是一位精通資料庫底層與 SQL 改寫的資深架構師。請診斷以下 SQL：
### 🔍 1. 代碼邏輯與數據流 (Logic Flow)
- **路徑追蹤**：說明資料如何被串接與篩選。
- **遺失風險**：指出哪些 Join 或過濾條件可能導致資料遺失。
### 🚨 2. 關鍵問題與風險 (Critical Issues)
- 列出 Bug、NULL 陷阱、或是被吃掉的 Exception。
### 🔄 3. 重構建議與效能優化 (Refactoring & Efficiency)
- **查詢整合**：評估是否能利用 CTE (WITH) 或 Bulk Collect 優化。
- **效能地雷**：指出索引失效或重複讀取的風險。
### 🧪 4. 救火計畫 (Action Plan)
- **測試建議**：列出必須驗證的極端值場景。
- **優化代碼**：提供重構後更簡潔、效能更好的 SQL 片段。
${getJsonInstruction(false)}
待診斷程式碼：\n${sql}`;

    // 🧠 模式 2：寫文件專用
    const docPrompt = `你是一位擁有 20 年經驗的頂尖 DBA。請針對以下 SQL 進行深度拆解：
### 1. 📝 核心業務邏輯 (Business Flow)
- 用白話文描述這段程式碼的終極目標與觸發條件。
### 2. 🗄️ 資料表影響評估 (CRUD Analysis)
| 資料表名稱 | 操作類型 (C/R/U/D) | 關鍵欄位 | 說明 |
| :--- | :--- | :--- | :--- |
| (請列出所有異動到的 Table) | | | |
### 3. 🏗️ 程式邏輯階層 (Logic Hierarchy)
- 描述主程序與子程序的調度關係。
### 4. 💡 現代化重構建議
- 針對維護面與可讀性給出具體建議。
${getJsonInstruction(false)}
請解析以下程式碼：\n${sql}`;

    // 🧠 模式 3：🔎 執行路徑追蹤
    const tracePrompt = `你是一位頂尖的虛擬 Debugger，專門模擬 Oracle PL/SQL 的步進執行。
請針對以下 SQL 進行「執行狀態追蹤」，並產出報告：
### 🕵️ 1. 步進執行日誌 (Step-by-Step Trace)
- 請模擬程式執行流，說明每一組邏輯區塊的執行順序。
### 🧬 2. 變數狀態快照 (Variable State)
- 追蹤關鍵變數 (Local Variables) 與參數 (Parameters) 的值變化。
### ⚠️ 3. 邏輯死角與異常預測
${getJsonInstruction(true)}
待追蹤程式碼：\n${sql}`;

    // 決定最終 Prompt
    let finalPrompt = '';
    if (mode === 'debug') finalPrompt = debugPrompt;
    else if (mode === 'document') finalPrompt = docPrompt;
    else if (mode === 'trace') finalPrompt = tracePrompt;
    else finalPrompt = debugPrompt;

    // 🔥 核心邏輯：切換引擎
    if (apiKey.toLowerCase() === 'ollama') {
      // 走地端 RTX 5060 路徑
      return this.analyzeWithLocalOllama(finalPrompt);
    } else {
      // 走原本的 Gemini 雲端路徑
      return this.analyzeWithGemini(finalPrompt, apiKey);
    }
  }

  /**
   * [地端] 使用 Ollama + RTX 5060 運算
   */
   private async analyzeWithLocalOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(this.localOllamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5-coder:7b',
          prompt: prompt,
          stream: false,
          // 💡 針對 100-500 行 SQL 的最佳化參數
          options: {
            num_ctx: 16384,     // 🧠 調降到 16k，能讓 CPU 預處理變快，顯存壓力也較小
            num_predict: -1,    // 🚀 強制 AI 把話說完，不論 JSON 多長都不會被切斷
            temperature: 0.1,   // 降低隨機性，確保 JSON 結構百分之百正確
            top_p: 0.9          // 保持邏輯嚴謹
          }
        }),
      });
  
      if (!response.ok) throw new Error('地端顯卡拒絕連線');
      
      const data = await response.json();
      
      // 💡 雙重清洗：確保回傳的是純淨內容
      let cleanText = data.response;
      
      // 如果 AI 沒寫完 (沒有 [MAP_END])，進行補齊嘗試
      if (cleanText.includes('[MAP_START]') && !cleanText.includes('[MAP_END]')) {
        console.warn('偵測到 JSON 截斷，補齊中...');
        cleanText += '\n]\n[MAP_END]';
      }
  
      return this.cleanAiResponse(cleanText);
    } catch (error) {
      throw new Error('考古機發生故障：' + error);
    }
  }

  /**
   * [雲端] 使用 Google Gemini 運算
   */
  private async analyzeWithGemini(prompt: string, apiKey: string): Promise<string> {
    const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData.error, null, 2));
    }

    const data = await response.json();
    this.updateUsage();
    return data.candidates[0].content.parts[0].text;
  }

  /**
   * 清除 AI 回傳內容中干擾解析的字串 (如 ```json)
   */
  private cleanAiResponse(raw: string): string {
    return raw
      .replace(/```json/g, '')
      .replace(/```sql/g, '')
      .replace(/```/g, '')
      .trim();
  }

  private updateUsage() {
    const next = this.usageCount() + 1;
    this.usageCount.set(next);
    localStorage.setItem('DAILY_USAGE', next.toString());
  }
}