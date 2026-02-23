import { Component, signal, effect, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GeminiService } from './services/gemini';
import { marked } from 'marked';

// 💡 完整介面：支援分支與變數觀察
interface TraceStep {
  label: string; 
  desc: string; 
  line: number; 
  anchor?: string;
  impact: string;
  branch?: string;    // 👈 新增：邏輯分支條件
  vars?: { name: string, value: string }[]; // 👈 新增：變數快照
}

interface SubProgram {
  name: string;
  type: string; 
  summary: string;
  calls?: string[];
  steps?: TraceStep[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent {
  private sanitizer = inject(DomSanitizer);
  gemini = inject(GeminiService);

  // 1. 核心狀態
  apiKey = signal(sessionStorage.getItem('G_KEY') || '');
  selectedMode = signal(sessionStorage.getItem('SYS_MODE') || 'debug');
  sqlInput = signal('');
  result = signal('');
  loading = signal(false);
  isAnalyzed = signal(false); 

  // 2. 導航與互動資料
  subPrograms = signal<SubProgram[]>([]);
  renderedCode = signal<SafeHtml>('');
  
  // 💡 新增：目前選中的執行步驟 (用於變數觀察窗)
  selectedStep = signal<TraceStep | null>(null);

  peekData = signal<{ 
    name: string, 
    summary: string, 
    calls?: string[], 
    isExternal: boolean, 
    pos: { x: number, y: number } 
  } | null>(null);

  // 3. 佈局設定
  layoutConfig = signal('280px 4px 1fr 4px 450px');
  resizingPart: 'map' | 'report' | null = null;

  // 4. 計算屬性：解析 Markdown 報告
  parsedResult = computed(() => {
    const raw = this.result();
    // 移除 JSON 地圖區塊後再渲染 Markdown
    return raw ? marked.parse(raw.replace(/\[MAP_START\][\s\S]*?\[MAP_END\]/, '')) : '';
  });

  constructor() {
    effect(() => sessionStorage.setItem('G_KEY', this.apiKey()));
    effect(() => sessionStorage.setItem('SYS_MODE', this.selectedMode()));
  }

  // --- 介面拉伸邏輯 ---
  startResizing(part: 'map' | 'report') { this.resizingPart = part; }
  onMouseUp() { this.resizingPart = null; }
  onMouseMove(e: MouseEvent) {
    if (!this.resizingPart) return;
    const config = this.layoutConfig().split(' ');
    if (this.resizingPart === 'map') config[0] = `${Math.max(100, e.clientX)}px`;
    else config[4] = `${Math.max(200, window.innerWidth - e.clientX)}px`;
    this.layoutConfig.set(config.join(' '));
  }

  // --- 核心救火邏輯 ---
  async startRescue() {
    if (!this.apiKey() || !this.sqlInput()) return;
    this.loading.set(true);
    this.result.set('');
    this.isAnalyzed.set(false);
    this.selectedStep.set(null); // 清除舊的選中步驟

    try {
      const output = await this.gemini.analyzeSql(this.sqlInput(), this.apiKey(), this.selectedMode());
      this.result.set(output);

      const match = output.match(/\[MAP_START\]([\s\S]*?)\[MAP_END\]/);
      if (match) {
        let jsonString = match[1].trim();
        
        // 🧼 如果 AI 頑皮加了 ```json，把它們濾掉
        jsonString = jsonString.replace(/^```json/, '').replace(/```$/, '').trim();
        
        try {
          this.subPrograms.set(JSON.parse(jsonString));
        } catch (jsonErr) {
          console.error("JSON 解析失敗，內容為：", jsonString);
          throw new Error("AI 回傳的 JSON 格式不完整，可能是因為 SQL 過長導致回傳被切斷。");
        }
      }

      this.generateInteractiveView();
      this.isAnalyzed.set(true); 
    } catch (e: any) {
      this.result.set(`🚨 錯誤：${e.message}`);
    } finally {
      this.loading.set(false);
    }
  }

  // 💡 渲染：帶有行號與 ID 的程式碼檢視器
  generateInteractiveView() {
    const lines = this.sqlInput().split('\n');
    let html = '';

    lines.forEach((lineText, index) => {
      const lineNum = index + 1;
      let processedLine = lineText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // 高亮程序名稱
      this.subPrograms().forEach(p => {
        const escapedName = p.name.replace(/\./g, '\\.');
        const reg = new RegExp(`\\b${escapedName}\\b`, 'gi');
        processedLine = processedLine.replace(reg, `<span class="code-link" data-name="${p.name}">${p.name}</span>`);
      });

      html += `
        <div class="code-line" id="L-${lineNum}">
          <span class="line-num-gutter">${lineNum}</span>
          <span class="line-text">${processedLine || ' '}</span>
        </div>`;
    });

    this.renderedCode.set(this.sanitizer.bypassSecurityTrustHtml(html));
  }

  // --- 互動事件 ---

  // 💡 選取步驟：觸發跳轉並開啟變數觀察
  selectStep(step: TraceStep) {
    this.selectedStep.set(step);
    
    // 🔍 搜尋「真正」的行號
    let realLine = step.line;
    const rawCode = this.sqlInput();
    
    if (step.anchor && rawCode) {
      const lines = rawCode.split('\n');
      // 尋找包含 anchor 內容的那一行 (忽略前後空白)
      const foundIndex = lines.findIndex(l => 
        l.trim().includes(step.anchor!.trim())
      );
      
      if (foundIndex !== -1) {
        realLine = foundIndex + 1; // 修正為真實行號
      }
    }
  
    this.scrollToLine(realLine);
  }

  scrollToLine(lineNum: number) {
    if (!lineNum) return;
    const el = document.getElementById(`L-${lineNum}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-line-flash');
      setTimeout(() => el.classList.remove('highlight-line-flash'), 2000);
    }
  }

  scrollTo(name: string) {
    const el = document.querySelector(`span[data-name="${name}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const lineEl = el.closest('.code-line');
      if (lineEl) {
        lineEl.classList.add('highlight-line-flash');
        setTimeout(() => lineEl.classList.remove('highlight-line-flash'), 2000);
      }
    }
  }

  handleHover(event: MouseEvent, name?: string) {
    const targetName = name || (event.target as HTMLElement).getAttribute('data-name');
    if (targetName) {
      const prog = this.subPrograms().find(p => p.name.toUpperCase() === targetName.toUpperCase());
      if (prog) {
        const isExt = prog.type === 'EXTERNAL';
        this.peekData.set({
          name: prog.name,
          summary: isExt ? `🔮 AI 推測功能：${prog.summary}` : prog.summary,
          calls: prog.calls,
          isExternal: isExt,
          pos: { x: event.clientX + 15, y: event.clientY + 15 }
        });
      }
    }
  }

  hidePeek() { this.peekData.set(null); }

  showPeek(event: MouseEvent, prog: SubProgram) {
    const isExt = prog.type === 'EXTERNAL';
    this.peekData.set({
      name: prog.name,
      summary: isExt ? `🔮 AI 推測功能：${prog.summary}` : prog.summary,
      calls: prog.calls,
      isExternal: isExt,
      pos: { x: event.clientX + 20, y: event.clientY - 20 }
    });
  }

  // 重新輸入
  reset() {
    this.isAnalyzed.set(false);
    this.selectedStep.set(null);
  }
}