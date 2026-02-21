import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'; // 確認你的模型版本
  usageCount = signal(Number(localStorage.getItem('DAILY_USAGE')) || 0);

  // 🔥 這裡多加了一個 mode 參數
  async analyzeSql(sql: string, apiKey: string, mode: string): Promise<string> {
    
    // 🧠 模式 1：找 Bug 專用 Prompt
    const debugPrompt = `你是一位負責「系統救火」的資深資料庫專家與除錯大師。
請針對以下這段 SQL 進行極度嚴格的 Code Review，找出潛在 Bug 與效能地雷。
嚴格按照以下 Markdown 格式回覆：
### 1. 🚨 嚴重 Bug 與邏輯致命傷
### 2. ⚠️ 效能地雷與鎖表風險
### 3. 🛡️ 邊界條件與 NULL 陷阱
### 4. 🛠️ 具體修復方案 (附上修復後的 SQL 程式碼)
---
請掃描以下程式碼：\n${sql}`;

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