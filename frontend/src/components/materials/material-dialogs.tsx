"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { deleteMaterial, renameMaterial, type Material } from "@/lib/materials";

/* Rename a file: PATCH /api/materials/{id} with { title } */
export function RenameMaterialDialog({
  material,
  onClose,
  onSaved,
}: {
  material: Material | null;
  onClose: () => void;
  onSaved: (m: Material) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={material !== null}
      onClose={onClose}
      busy={busy}
      title="Rename file"
      description="Only the name shown in StudyMate changes. The PDF itself stays as it is."
    >
      {material && (
        <RenameForm key={material.id} material={material} busy={busy} setBusy={setBusy} onCancel={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

function RenameForm({
  material,
  busy,
  setBusy,
  onCancel,
  onSaved,
}: {
  material: Material;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onCancel: () => void;
  onSaved: (m: Material) => void;
}) {
  const [title, setTitle] = useState(material.title);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Give the file a name.");
    setBusy(true);
    try {
      onSaved(await renameMaterial(material.id, title));
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors.title ?? err.message) : "Couldn't rename the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <FormField
        id="material-title"
        label="Name"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError(null);
        }}
        error={error ?? undefined}
        hint={`File: ${material.original_filename}`}
        maxLength={255}
        autoComplete="off"
        data-autofocus
        disabled={busy}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {busy ? "Saving..." : "Save name"}
        </Button>
      </div>
    </form>
  );
}

/* Delete a file: DELETE /api/materials/{id} (also removes its passages and the PDF on disk) */
export function DeleteMaterialDialog({
  material,
  onClose,
  onDeleted,
}: {
  material: Material | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  async function onConfirm() {
    if (!material) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMaterial(material.id);
      onDeleted(material.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) onDeleted(material.id); // already gone
      else setError(err instanceof ApiError ? err.message : "Couldn't delete the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={material !== null}
      onClose={close}
      busy={busy}
      title={`Delete "${material?.title ?? ""}"?`}
      description="The PDF and everything StudyMate read from it are removed. Answers won't use it any more. This can't be undone."
    >
      <div className="grid gap-5">
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={close} disabled={busy} data-autofocus>
            Keep it
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {busy ? "Deleting..." : "Delete file"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
