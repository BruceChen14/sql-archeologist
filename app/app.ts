import { Component, signal, effect, inject, computed, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GeminiService } from './services/gemini';
import { marked } from 'marked';

// 💡 完整介面：支援分支與數據演變
interface TraceStep {
  label: string; 
  desc: string; 
  line: number; 
  anchor?: string;
  impact: string; // 數據演變 (Evolution)
  vars?: { name: string, value: string }[]; 
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
  private cdr = inject(ChangeDetectorRef);
  gemini = inject(GeminiService);

  // 1. 核心狀態
  apiKey = signal(sessionStorage.getItem('G_KEY') || '');
  selectedMode = signal(sessionStorage.getItem('SYS_MODE') || 'document'); 
  sqlInput = signal('');
  result = signal('');
  loading = signal(false);
  isAnalyzed = signal(false); 
  testParams = signal('');

  // 2. 導航與互動資料
  subPrograms = signal<SubProgram[]>([]);
  renderedCode = signal<SafeHtml>('');
  selectedStep = signal<TraceStep | null>(null);

  // 浮動預覽資料
  peekData = signal<{ 
    name: string, 
    summary: string, 
    calls?: string[], 
    isExternal: boolean, 
    pos: { x: number, y: number } 
  } | null>(null);

  // 3. 佈局設定
  layoutConfig = signal('320px 4px 1fr 4px 480px');
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
    if (this.resizingPart === 'map') config[0] = `${Math.max(150, e.clientX)}px`;
    else config[4] = `${Math.max(200, window.innerWidth - e.clientX)}px`;
    this.layoutConfig.set(config.join(' '));
  }

  // --- 核心救火邏輯 ---
  async startRescue() {
    if (!this.apiKey() || !this.sqlInput()) return;
    
    // 1. 初始化狀態
    this.loading.set(true);
    this.result.set('');
    this.isAnalyzed.set(false);
    this.selectedStep.set(null); 
    this.subPrograms.set([]); // 清除舊的地圖

    try {
      const output = await this.gemini.analyzeSql(
        this.sqlInput(), 
        this.apiKey(), 
        this.selectedMode(), 
        this.testParams()
      );
      this.result.set(output);
      console.log("=== AI 原始回傳內容 ===");
      console.log(output);
      // 2. 強化版 Regex 提取：不論 AI 前後加了什麼廢話都能抓到
      const regex = /\[MAP_START\]([\s\S]*?)\[MAP_END\]/i;
      const match = output.match(regex);

      if (match && match[1]) {
        let jsonString = match[1].trim();
        
        // 🧼 3. 超級清潔：濾掉 Markdown 標籤與潛在的非法字元
        jsonString = jsonString
          .replace(/^```json/g, '')
          .replace(/^```/g, '')
          .replace(/```$/g, '')
          .replace(/[\u201C\u201D]/g, '"') // 將「智慧引號」換成標準引號
          .trim();

        try {
          const parsed = JSON.parse(jsonString);
          this.subPrograms.set(parsed);
        } catch (jsonErr) {
          console.warn("第一次 JSON 解析失敗，嘗試暴力修復...");
          // 🛠️ 嘗試修復地端模型常犯的錯：多餘的逗號
          const fixedJson = jsonString
            .replace(/,(\s*[\]}])/g, '$1') // 移除陣列或物件末尾的多餘逗號
            .replace(/（/g, '(').replace(/）/g, ')'); // 修正中文括號
          
          this.subPrograms.set(JSON.parse(fixedJson));
        }

        // 4. 渲染程式碼檢視器
        this.generateInteractiveView();
        this.isAnalyzed.set(true);

        this.cdr.detectChanges(); 

        // 如果有自動跳轉邏輯，放在 detectChanges 之後
        if (this.selectedMode() === 'trace') {
          const firstStep = this.subPrograms()[0]?.steps?.[0];
          if (firstStep) this.selectStep(firstStep);
        }
        // 💡 5. UX 優化：如果是 Trace 模式，自動選取第一個程序的起始步驟
        if (this.selectedMode() === 'trace') {
          const firstProg = this.subPrograms().find(p => p.steps && p.steps.length > 0);
          if (firstProg && firstProg.steps) {
            this.selectStep(firstProg.steps[0]);
          }
        }

      } else {
        console.error("未找到 JSON 標籤 [MAP_START]，輸出的原始內容為：", output);
        // 如果沒有 JSON 但有文字分析，依然讓使用者看文字
        this.isAnalyzed.set(false); 
      }

    } catch (e: any) {
      console.error("考古失敗詳情：", e);
      this.result.set(`🚨 考古失敗：${e.message}\n\n這通常是因為 SQL 過長或 API 連線中斷。`);
    } finally {
      this.loading.set(false);
    }
  }

  // 💡 渲染：帶有高亮連結的程式碼檢視器
  generateInteractiveView() {
    const code = this.sqlInput();
    if (!code) return;
  
    const lines = code.split('\n');
    let html = '';
  
    lines.forEach((lineText, index) => {
      const lineNum = index + 1;
      // 安全轉義 HTML
      let processedLine = lineText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  
      // 高亮 SubPrograms
      this.subPrograms().forEach(p => {
        const reg = new RegExp(`\\b${p.name.replace(/\./g, '\\.')}\\b`, 'gi');
        processedLine = processedLine.replace(reg, `<span class="code-link" data-name="${p.name}">${p.name}</span>`);
      });
  
      // 🚀 確保 id="L-數字" 的格式絕對正確，不帶空格
      html += `<div class="code-line" id="L-${lineNum}"><span class="line-num-gutter">${lineNum}</span><span class="line-text">${processedLine || ' '}</span></div>`;
    });
  
    this.renderedCode.set(this.sanitizer.bypassSecurityTrustHtml(html));
  }

  // --- 互動與導航事件 ---

  // 1. 處理程式碼中的懸浮事件 (Peek)
  handleHover(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const name = target.getAttribute('data-name');
    if (name) {
      this.showPeek(event, name);
    }
  }

  // 2. 顯示預覽卡片
  showPeek(event: MouseEvent, item: string | SubProgram) {
    const targetName = typeof item === 'string' ? item : item.name;
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

  // 3. 隱藏預覽卡片
  hidePeek() {
    this.peekData.set(null);
  }

  // 4. 點擊步驟：跳轉行號並開啟數據觀察
  selectStep(step: TraceStep) {
    this.selectedStep.set(step);
    
    // 🔍 1. 優先權校準：以內容搜尋 (anchor) 為準，而非死板的行號
    let targetLine = step.line;
    const rawCode = this.sqlInput();
    
    if (step.anchor && rawCode) {
      const lines = rawCode.split('\n');
      // 透過關鍵字尋找真正的行號 (去掉前後空格比較穩)
      const foundIndex = lines.findIndex(l => 
        l.trim().includes(step.anchor!.trim())
      );
      
      if (foundIndex !== -1) {
        targetLine = foundIndex + 1;
        console.log(`🎯 透過關鍵字定位到第 ${targetLine} 行`);
      }
    }
  
    // 🚀 2. 關鍵修正：延遲執行 (setTimeout)
    // 給 Angular 100 毫秒的時間把 *ngIf 裡面的 HTML 渲染出來
    setTimeout(() => {
      this.scrollToLine(targetLine);
    }, 100);
  }

  // 5. 滾動到特定行號並閃爍
  scrollToLine(lineNum: number, retryCount = 0) {
    if (!lineNum) return;
    const id = `L-${lineNum}`;
    const el = document.getElementById(id);
  
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-line-flash');
      setTimeout(() => el.classList.remove('highlight-line-flash'), 2000);
    } else if (retryCount < 10) {
      // 🚀 如果找不到，50ms 後再試一次
      setTimeout(() => this.scrollToLine(lineNum, retryCount + 1), 50);
    } else {
      console.error(`❌ 徹底失敗：嘗試 10 次後仍找不到 ID 為 ${id} 的元素。`);
    }
  }

  // 6. 滾動到特定程序定義處
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

  // 7. 重設狀態
  reset() {
    this.isAnalyzed.set(false);
    this.selectedStep.set(null);
    this.testParams.set('');
  }
}