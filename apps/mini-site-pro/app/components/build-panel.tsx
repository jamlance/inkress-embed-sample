// Sections editor — drag-drop block list + add menu + per-block editor.
// Shell-agnostic: edits the workspace `sections` state (so the shell's live
// preview updates) and autosaves to /api/sections. Used by both shells.
import { useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { BLOCK_META, BLOCK_TYPES, newBlockId } from "~/lib/blocks.mjs";
import { BlockEditor } from "~/components/block-editor";

export type Block = { id: string; type: string; data: Record<string, any> };

function SortableBlock({ block, onEdit, onRemove }: { block: Block; onEdit: (id: string) => void; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const meta = (BLOCK_META as Record<string, any>)[block.type] || { label: block.type, icon: "▫︎", summary: () => "" };
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} className="mk-block">
      <button className="mk-handle" {...attributes} {...listeners} aria-label="Drag to reorder" type="button">⠿</button>
      <span className="mk-block-icon">{meta.icon}</span>
      <div className="mk-block-main">
        <div className="mk-block-label">{meta.label}</div>
        <div className="bv-muted bv-sm">{meta.summary(block.data)}</div>
      </div>
      <div className="bv-row">
        <button className="bv-btn sm" type="button" onClick={() => onEdit(block.id)}>Edit</button>
        <button className="bv-btn sm" type="button" aria-label="Remove block" onClick={() => onRemove(block.id)}>✕</button>
      </div>
    </div>
  );
}

function AddBlockMenu({ onPick, onClose }: { onPick: (t: string) => void; onClose: () => void }) {
  return (
    <div className="mk-modal-backdrop" onClick={onClose}>
      <div className="mk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add a block">
        <div className="mk-modal-head">
          <b>Add a block</b>
          <button className="mk-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mk-modal-body">
          <div className="mk-addgrid">
            {(BLOCK_TYPES as string[]).map((t) => {
              const m = (BLOCK_META as Record<string, any>)[t];
              return (
                <button key={t} className="mk-addbtn" type="button" onClick={() => onPick(t)}>
                  <span style={{ fontSize: "1.5rem" }}>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BuildPanel({
  sections,
  setSections,
  saved,
  setSaved,
}: {
  sections: Block[];
  setSections: (b: Block[]) => void;
  saved: boolean;
  setSaved: (b: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function persist(next: Block[], opts: { immediate?: boolean } = {}) {
    setSections(next);
    setSaved(false);
    const run = async () => {
      await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: next }),
      }).catch(() => {});
      setSaved(true);
    };
    if (debounce.current) clearTimeout(debounce.current);
    if (opts.immediate === false) debounce.current = setTimeout(run, 700);
    else run();
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = sections.findIndex((s) => s.id === active.id);
    const newI = sections.findIndex((s) => s.id === over.id);
    if (oldI < 0 || newI < 0) return;
    persist(arrayMove(sections, oldI, newI));
  }
  function addBlock(type: string) {
    setAdding(false);
    const id = newBlockId();
    persist([...sections, { id, type, data: (BLOCK_META as Record<string, any>)[type].def() }]);
    setEditing(id);
  }
  const editData = (id: string, data: Record<string, any>) =>
    persist(sections.map((s) => (s.id === id ? { ...s, data } : s)), { immediate: false });
  const remove = (id: string) => persist(sections.filter((s) => s.id !== id));
  const editingBlock = sections.find((s) => s.id === editing) || null;

  return (
    <div className="mk-panel">
      <div className="mk-panel-head">
        <div>
          <h2 className="mk-panel-title">Sections</h2>
          <p className="mk-panel-sub">Drag to reorder. Click a block to edit it.</p>
        </div>
        <span className="mk-saved">{saved ? "✓ Saved" : "Saving…"}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="mk-blocks">
            {sections.map((b) => (
              <SortableBlock key={b.id} block={b} onEdit={setEditing} onRemove={remove} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {sections.length === 0 && <div className="mk-emptyblocks">Empty page. Add your first block to start.</div>}
      <button className="mk-add-cta" type="button" onClick={() => setAdding(true)}>+ Add a block</button>

      {adding && <AddBlockMenu onPick={addBlock} onClose={() => setAdding(false)} />}
      {editingBlock && <BlockEditor block={editingBlock} onChange={(data) => editData(editingBlock.id, data)} onClose={() => setEditing(null)} />}
    </div>
  );
}
