import { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Dialog, DialogHeader, DialogPopup } from './ui/dialog';
import { Button } from './ui/button';
import { applyImport, parseImportText, type ImportResult } from '@/lib/transfer';
import { cn } from '@/lib/cn';

export function ImportDialog({
  open,
  onOpenChange,
  rootId,
  favorites,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootId: string;
  favorites: string[];
  onDone: (res: ImportResult) => void;
}) {
  const [rawText, setRawText] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (rawText.trim() ? parseImportText(rawText) : null), [rawText]);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(String(reader.result || ''));
      setErrorMsg('');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleSubmit = async () => {
    if (!parsed || !parsed.ok || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await applyImport(rootId, parsed.data, mode, favorites);
      setRawText('');
      onOpenChange(false);
      onDone(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入失败，请检查书签权限');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[540px] flex flex-col">
        <DialogHeader
          title="导入书签 JSON"
          extra={
            <>
              <Button variant="outline" size="xs" onClick={() => fileRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" />
                选择文件…
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json,text/plain"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </>
          }
        />

        <div className="p-5 space-y-3">
          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setErrorMsg('');
            }}
            spellCheck={false}
            placeholder="选择 .json 文件，或直接粘贴整理后的 JSON 文本（自动识别 ```json 代码块）…"
            className="w-full h-[188px] p-3 border border-line2 bg-background font-mono text-xs leading-relaxed text-ink resize-y focus:outline-none focus:bg-surface focus:border-accent-line focus:shadow-[0_0_0_2px_var(--blue-soft)]"
          />

          <div
            className={cn(
              'text-xs leading-relaxed',
              errorMsg || (parsed && !parsed.ok)
                ? 'text-danger'
                : parsed?.ok
                  ? 'text-accent'
                  : 'text-ink3',
            )}
          >
            {errorMsg
              ? errorMsg
              : !parsed
                ? '等待选择文件或粘贴 JSON…'
                : parsed.ok
                  ? `已识别：${parsed.stats.topCount} 个一级分组 · ${parsed.stats.subCount} 个子分组 · ${parsed.stats.itemCount} 条书签${
                      parsed.stats.favCount ? ` · ${parsed.stats.favCount} 条星标` : ''
                    }${parsed.stats.skipped ? `（已跳过 ${parsed.stats.skipped} 条无效链接）` : ''}`
                  : parsed.error}
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-[12.5px] text-ink2 cursor-pointer select-none">
              <input
                type="radio"
                name="imp-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
                className="accent-accent"
              />
              <span>替换当前数据源目录（执行前自动先下载备份）</span>
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-ink2 cursor-pointer select-none">
              <input
                type="radio"
                name="imp-mode"
                checked={mode === 'append'}
                onChange={() => setMode('append')}
                className="accent-accent"
              />
              <span>追加为新分组（不改动现有书签）</span>
            </label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line bg-background flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!parsed?.ok || busy} onClick={handleSubmit}>
            {busy ? '导入中…' : mode === 'replace' ? '备份并替换导入' : '追加导入'}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
