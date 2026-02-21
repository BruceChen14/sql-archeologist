import { Component, signal, effect, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GeminiService } from './services/gemini';
import { marked } from 'marked';

interface SubProgram {
  name: string;
  type: string; // PROCEDURE, FUNCTION, 或 EXTERNAL
  summary: string;
  calls?: string[];
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

  // 2. 導航與互動
  subPrograms = signal<SubProgram[]>([]);
  renderedCode = signal<SafeHtml>('');
  
  // 💡 修正：在此定義 peekData 的型別，包含 isExternal
  peekData = signal<{ 
    name: string, 
    summary: string, 
    calls?: string[], 
    isExternal: boolean, // 👈 新增此屬性
    pos: { x: number, y: number } 
  } | null>(null);

  // 3. 佈局
  layoutConfig = signal('260px 4px 1fr 4px 450px');
  resizingPart: 'map' | 'report' | null = null;

  parsedResult = computed(() => {
    const raw = this.result();
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

    try {
      const output = await this.gemini.analyzeSql(this.sqlInput(), this.apiKey(), this.selectedMode());
      this.result.set(output);

      const match = output.match(/\[MAP_START\]([\s\S]*?)\[MAP_END\]/);
      if (match) this.subPrograms.set(JSON.parse(match[1]));

      this.generateInteractiveView();
      this.isAnalyzed.set(true); 
    } catch (e: any) {
      this.result.set(`🚨 錯誤：${e.message}`);
    } finally {
      this.loading.set(false);
    }
  }

  generateInteractiveView() {
    let html = this.sqlInput()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    this.subPrograms().forEach(p => {
      // 外部依賴通常包含點號，正則需特別處理
      const escapedName = p.name.replace(/\./g, '\\.');
      const reg = new RegExp(`\\b${escapedName}\\b`, 'gi');
      html = html.replace(reg, `<span class="code-link" data-name="${p.name}">${p.name}</span>`);
    });

    this.renderedCode.set(this.sanitizer.bypassSecurityTrustHtml(html));
  }

  // --- 互動事件 ---

  // 💡 修正：handleHover (代碼區 span 使用) 現在也會帶入 isExternal 狀態
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
          isExternal: isExt, // 👈 設定正確狀態
          pos: { x: event.clientX + 15, y: event.clientY + 15 }
        });
      }
    }
  }

  hidePeek() { this.peekData.set(null); }

  scrollTo(name: string) {
    const el = document.querySelector(`span[data-name="${name}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-flash');
      setTimeout(() => el.classList.remove('highlight-flash'), 2000);
    }
  }

  // 💡 修正：showPeek (左側導航清單使用)
  showPeek(event: MouseEvent, prog: SubProgram) {
    const isExt = prog.type === 'EXTERNAL';
    this.peekData.set({
      name: prog.name,
      summary: isExt ? `🔮 AI 推測功能：${prog.summary}` : prog.summary,
      calls: prog.calls,
      isExternal: isExt, // 👈 設定正確狀態
      pos: { x: event.clientX + 20, y: event.clientY - 20 }
    });
  }
}