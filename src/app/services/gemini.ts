import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private apiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'; // 確認你的模型版本
  usageCount = signal(Number(localStorage.getItem('DAILY_USAGE')) || 0);

  // 🔥 這裡多加了一個 mode 參數
  async analyzeSql(sql: string, apiKey: string, mode: string): Promise<string> {
    // 🧠 模式 1：找 Bug 專用 Prompt
    const debugPrompt = `你是一位精通資料庫底層與 SQL 改寫的資深架構師。
請診斷以下 SQL 片段，這可能是一段邏輯、一個 Function，或多個試圖組合資料的 SELECT 語句。

### 🧐 診斷與重構原則：
1. **規模自適應**：從小 Function 到大 Package 都能給出對應深度的建議。
2. **查詢整合 (Query Consolidation)**：若代碼包含多個分散的 SELECT，請優先評估是否能整合為「單一高效 Join」或使用「CTE (WITH 語句)」。
3. **性能優先**：找出導致資料遺失 (Data Loss) 的斷點，並提出更現代的寫法。

請嚴格按照以下格式回覆：

### 🔍 1. 代碼邏輯與數據流 (Logic Flow)
- **路徑追蹤**：說明資料如何被串接與篩選。
- **遺失風險**：指出哪些 Join (如 Inner Join) 或過濾條件可能導致資料沒撈到。

### 🚨 2. 關鍵問題與風險 (Critical Issues)
- 列出 Bug、NULL 陷阱、或是被吃掉的 Exception。
- 指出跨程序呼叫的副作用。

### 🔄 3. 重構建議與效能優化 (Refactoring & Efficiency)
- **查詢整合**：如果有多個 SELECT 組成的 Cursor，請說明如何利用 CTE (WITH)、Subquery 或 Bulk Collect 簡化邏輯並提升效能。
- **效能地雷**：指出索引失效、鎖表或重複讀取的風險。

### 🧪 4. 救火計畫 (Action Plan)
- **測試建議**：列出必須驗證的場景（含極端值）。
- **優化代碼**：提供重構後「更簡潔、效能更好」的 SQL 代碼片段。

### 🚨 重要：請在回覆的最末端，附加一個符合以下 JSON 格式的區塊，用於生成導航地圖。
請將 JSON 包裹在 [MAP_START] 與 [MAP_END] 標籤之間。
特別注意：
1. 找出所有本地定義的 PROCEDURE 與 FUNCTION。
2. **外部依賴偵測**：若發現代碼呼叫了外部 Package（格式如 PKG_NAME.PROC_NAME），且該 Package 不在本次貼上的代碼內，請將其加入 JSON 並標註 "type": "EXTERNAL"。
3. **功能推測**：針對 EXTERNAL 類型，請根據傳入參數與語境，在 summary 中推測其核心功能與可能的風險。

[MAP_START]
[
  { 
    "name": "本地或外部程式名", 
    "type": "PROCEDURE / FUNCTION / EXTERNAL", 
    "summary": "一句話描述邏輯 (EXTERNAL 則提供推測)", 
    "calls": ["子程式1", "子程式2"] 
  }
]
[MAP_END]
---

待診斷/重構程式碼：\n${sql}`;

    // 🧠 模式 2：寫文件專用 Prompt
    const docPrompt = `你是一位擁有 20 年經驗的頂尖 DBA 與系統架構師。
請針對以下 SQL 進行「深度邏輯拆解與架構分析」。
請嚴格遵守以下 Markdown 格式，禁止任何客套話與開場白：

### 1. 📝 核心業務邏輯 (Business Flow)
- 請用開發者與業務端都能理解的「白話文」描述這段程式碼的終極目標。
- 描述核心觸發條件與最終產出的資料狀態。

### 2. 🗄️ 資料表影響評估 (CRUD Analysis)
| 資料表/視圖名稱 | 操作類型 (C/R/U/D) | 關鍵欄位 | 說明 |
| :--- | :--- | :--- | :--- |
| 範例 Table | Update | STATUS, UPD_TIME | 變更訂單狀態為已處理 |

### 3. 🏗️ 程式邏輯階層 (Logic Hierarchy)
- 請描述主程序與子程序之間的調度關係。
- 說明中間變數（Global Variables）如何影響後續判斷。

### 4. 💡 現代化重構建議
- **效能面**：針對 Index 使用、Cursor 效能或迴圈優化給出具體建議。
- **維護面**：如何提升代碼的可讀性與模組化程度。

---
### 🚨 系統指令（解析地圖）：
請在回覆的最末端，附加一個符合以下 JSON 格式的區塊，用於生成導航地圖。
請將 JSON 包裹在 [MAP_START] 與 [MAP_END] 標籤之間。

[MAP_START]
[
  { 
    "name": "子程序名稱", 
    "type": "PROCEDURE 或 FUNCTION", 
    "summary": "一句話描述此區塊的核心邏輯", 
    "calls": ["呼叫的子程序1", "呼叫的子程序2"] 
  }
]
[MAP_END]

---
請解析以下程式碼：\n${sql}`;

    // 🔥 根據前端傳來的 mode 決定要用哪一套 Prompt
    const finalPrompt = mode === 'debug' ? debugPrompt : docPrompt;

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
