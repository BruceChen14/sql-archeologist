import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  // 建議使用 2.0-flash，速度最快且對 JSON 的遵循度很高
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'; 
  usageCount = signal(Number(localStorage.getItem('DAILY_USAGE')) || 0);

  async analyzeSql(sql: string, apiKey: string, mode: string): Promise<string> {
    
    // 🛠️ 內部 Helper：產出一致的 JSON 地圖指令
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

    // 🧠 模式 1：救火診斷 (原本的精準 Debug 模式)
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

    // 🧠 模式 2：寫文件專用 (原本的 CRUD 表格模式)
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

    // 🧠 模式 3：🔎 執行路徑追蹤 (全新偵探模式)
    const tracePrompt = `你是一位頂尖的虛擬 Debugger，專門模擬 Oracle PL/SQL 的步進執行。
請針對以下 SQL 進行「執行狀態追蹤」，並產出報告：

### 🕵️ 1. 步進執行日誌 (Step-by-Step Trace)
- 請模擬程式執行流，說明每一組邏輯區塊的執行順序。
- 當遇到 IF-ELSE 或 CASE 判斷時，請詳細說明「為何進入該分支」的判斷基準。

### 🧬 2. 變數狀態快照 (Variable State)
- 追蹤關鍵變數 (Local Variables) 與參數 (Parameters) 的值變化。
- 說明變數如何從 A 點的 Initial 狀態變為 B 點的 Result 狀態。

### ⚠️ 3. 邏輯死角與異常預測
- 找出哪些判斷式在極端資料下可能導致非預期的分支走向。
- 標註可能導致隱含錯誤 (Silent Error) 的變數賦值點。

${getJsonInstruction(true)}
待追蹤程式碼：\n${sql}`;

    // 🔥 邏輯：根據前端傳來的 mode 選擇對應的 Prompt
    let finalPrompt = '';
    if (mode === 'debug') finalPrompt = debugPrompt;
    else if (mode === 'document') finalPrompt = docPrompt;
    else if (mode === 'trace') finalPrompt = tracePrompt;
    else finalPrompt = debugPrompt;

    const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData.error, null, 2));
    }

    const data = await response.json();
    this.updateUsage();
    return data.candidates[0].content.parts[0].text;
  }

  private updateUsage() {
    const next = this.usageCount() + 1;
    this.usageCount.set(next);
    localStorage.setItem('DAILY_USAGE', next.toString());
  }
}