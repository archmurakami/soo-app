import { requireSupabase } from "./supabase-client.js";

const TABLE = "despesas";
const BUCKET = "comprovantes";

export async function listarDespesas(ownerId, obraId) {
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .eq("obra_id", obraId)
    .order("data", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function criarDespesa(ownerId, despesa) {
  const categoria = despesa.categoria || "A classificar";
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .insert({
      owner_id: ownerId,
      obra_id: despesa.obra_id,
      contato_id: despesa.contato_id || null,
      descricao: despesa.descricao,
      valor: Number(despesa.valor || 0),
      data: despesa.data,
      quem_pagou: despesa.quem_pagou || null,
      categoria,
      observacao: despesa.observacao || null,
      comprovante_path: despesa.comprovante_path || null,
      status_classificacao: categoria === "A classificar" ? "a_classificar" : "classificada"
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function atualizarDespesa(ownerId, despesaId, despesa) {
  const categoria = despesa.categoria || "A classificar";
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .update({
      contato_id: despesa.contato_id || null,
      descricao: despesa.descricao,
      valor: Number(despesa.valor || 0),
      data: despesa.data,
      quem_pagou: despesa.quem_pagou || null,
      categoria,
      observacao: despesa.observacao || null,
      comprovante_path: despesa.comprovante_path || null,
      status_classificacao: categoria === "A classificar" ? "a_classificar" : "classificada"
    })
    .eq("id", despesaId)
    .eq("owner_id", ownerId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function uploadComprovante(ownerId, obraId, file) {
  if (!file) return { path: null, warning: null };

  const safeName = file.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${ownerId}/${obraId}/${Date.now()}-${safeName}`;
  const { error } = await requireSupabase().storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });

  if (error) {
    return {
      path: null,
      warning:
        "Nao foi possivel enviar o comprovante. Verifique se o bucket comprovantes existe e se as politicas de Storage permitem upload do usuario autenticado. A despesa foi salva sem comprovante."
    };
  }

  return { path, warning: null };
}

export async function removerComprovante(path) {
  if (!path) return;
  const { error } = await requireSupabase().storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export async function obterUrlComprovante(path) {
  if (!path) return null;
  const { data, error } = await requireSupabase().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
