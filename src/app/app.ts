import { Component, signal, effect, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini';
import { marked } from 'marked';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent {
  gemini = inject(GeminiService);
  apiKey = signal(localStorage.getItem('G_KEY') || '');
  selectedMode = signal(localStorage.getItem('SYS_MODE') || 'debug');
  sqlInput = signal('');
  result = signal('');
  loading = signal(false);

  parsedResult = computed(() => {
    const rawText = this.result();
    return rawText ? marked.parse(rawText) : '';
  });

  constructor() {
    effect(() => localStorage.setItem('G_KEY', this.apiKey()));
    effect(() => localStorage.setItem('SYS_MODE', this.selectedMode()));
  }

  // 🔥 新增：資安脫敏核心邏輯 (Regex)
  sanitizeSql() {
    let currentSql = this.sqlInput();
    if (!currentSql) return;

    // 1. 替換 IP 位址 (例如 192.168.1.1 -> [MASKED_IP])
    currentSql = currentSql.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[MASKED_IP]');
    
    // 2. 替換 Email (例如 user@company.com -> [MASKED_EMAIL])
    currentSql = currentSql.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[MASKED_EMAIL]');
    
    // 3. 替換常見的密碼指派 (例如 Password = 'mySecret' -> Password = '[MASKED_PASSWORD]')
    // 支援大小寫的 password, pwd, pass
    currentSql = currentSql.replace(/(password|pwd|pass)\s*=\s*'[^']*'/gi, "$1 = '[MASKED_PASSWORD]'");

    // 將清洗後的結果塞回輸入框
    this.sqlInput.set(currentSql);
  }

  async onRun() {
    if (!this.apiKey() || !this.sqlInput()) return;
    this.loading.set(true);
    this.result.set('');
    
    try {
      const output = await this.gemini.analyzeSql(this.sqlInput(), this.apiKey(), this.selectedMode());
      this.result.set(output);
    } catch (e: any) {
      this.result.set(`🚨 發生錯誤：\n\n${e.message}`);
    } finally {
      this.loading.set(false);
    }
  }
}