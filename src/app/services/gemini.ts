import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'; // 確認你的模型版本
  usageCount = signal(Number(localStorage.getItem('DAILY_USAGE')) || 0);

  // 🔥 這裡多加了一個 mode 參數
  async analyzeSql(sql: string, apiKey: string, mode: string): Promise<string> {
    
    // 🧠 模式 1：找 Bug 專用 Prompt
    const debugPrompt = `你是一位負責「系統救火」的資深資料庫專家與除錯大師。
現在有一段 SQL 邏輯出現問題（可能是資料消失、流程中斷或舊程式改壞了）。
請針對以下 SQL 進行「深度邏輯診斷」與「影響分析」。

請嚴格按照以下格式回覆：

### 🕵️ 1. 邏輯斷點與資料流追蹤
- **關鍵路徑**：說明資料從哪張表進來，最後應該進到哪張表。
- **消失風險**：分析哪些 WHERE 條件或 JOIN (如 Inner Join) 可能導致資料被過濾掉。
- **中斷點**：指出程式碼中哪些 IF/CASE 分支或 EXCEPTION 處理可能導致流程偷偷結束。

### 🚨 2. 嚴重 Bug 與隱藏陷阱
- 找出邏輯錯誤、型別不匹配或未處理的例外。

### ⚠️ 3. 效能地雷與競爭風險
- 找出可能導致 Lock 或是 Package 5000 行執行過慢的效能瓶頸（如全表掃描）。

### 🧪 4. 測試驗證建議 (Test Scenarios)
- 針對這次修改，請列出至少 3 個必須測試的邊界場景（Edge Cases）。
- 提供一段簡單的測試 SQL 腳本來驗證修復結果。

### 🛠️ 5. 具體修復方案
- 附上優化或修復後的 SQL 片段。

---
請診斷以下程式碼：\n${sql}`;

    // 🧠 模式 2：寫文件專用 Prompt
    const docPrompt = `你是一位擁有 20 年經驗的資深 DBA。
請幫我解析以下這段 SQL，並嚴格按照以下 Markdown 格式回覆，不要講多餘廢話：
### 1. 📝 核心業務邏輯 (白話文總結)
### 2. 🗄️ 資料表影響評估 (CRUD 表格)
### 3. 💡 現代化重構建議
---
請解析以下程式碼：\n${sql}`;

    // 🔥 根據前端傳來的 mode 決定要用哪一套 Prompt
    const finalPrompt = mode === 'debug' ? debugPrompt : docPrompt;

    const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
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
