import { Dialog, DialogDescription, DialogHeader, DialogPopup } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import type { FolderSelectOption } from '@/lib/bookmarks';
import type { CreateTarget, DeleteTarget, EditTarget } from '@/pages/newtab/newtabTypes';

export function EditItemDialog({
  target,
  title,
  url,
  parentId,
  folders,
  error,
  onTitleChange,
  onUrlChange,
  onParentChange,
  onClose,
  onSubmit,
}: {
  target: EditTarget | null;
  title: string;
  url: string;
  parentId: string;
  folders: FolderSelectOption[];
  error: string;
  onTitleChange: (val: string) => void;
  onUrlChange: (val: string) => void;
  onParentChange: (val: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-[400px]">
        <DialogHeader title={target?.isFolder ? '编辑分组' : '编辑书签'} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="p-5 space-y-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink2">名称</span>
            <Input
              autoFocus
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={target?.isFolder ? '分组名称' : '书签名称'}
            />
          </label>

          {target && !target.isFolder && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink2">网址</span>
              <Input
                type="url"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://..."
                spellCheck={false}
                className="font-mono text-xs"
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink2">
              {target?.isFolder ? '上级分组' : '所属分组'}
            </span>
            <NativeSelect value={parentId} onChange={(e) => onParentChange(e.target.value)}>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </label>

          {error && <p className="m-0 text-xs text-danger">{error}</p>}

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function CreateFolderDialog({
  target,
  name,
  onNameChange,
  onClose,
  onSubmit,
}: {
  target: CreateTarget | null;
  name: string;
  onNameChange: (val: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-[380px]">
        <DialogHeader title={target?.dialogTitle || '新建分组'} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="p-5 space-y-4"
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="新分组名称"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              创建
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function getDeleteDescription(target: DeleteTarget | null): string {
  if (!target || !target.isFolder) return '删除后无法撤销。';
  if (target.descendantCount > 0) {
    return `连同里面的 ${target.descendantCount} 项一起删除，无法撤销。`;
  }
  return '这是一个空分组，删除后无法撤销。';
}

export function DeleteConfirmDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: DeleteTarget | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-[380px]">
        <DialogHeader title={target ? `删除「${target.title}」？` : '确认删除'} />
        <div className="p-5 space-y-4">
          <DialogDescription>{getDeleteDescription(target)}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button variant="danger" onClick={onConfirm}>
              删除
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
