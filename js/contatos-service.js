import { requireSupabase } from "./supabase-client.js";

const TABLE = "contatos";

export async function listarContatos(ownerId) {
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .order("nome", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function criarContato(ownerId, contato) {
  const tipos = Array.isArray(contato.tipos) ? contato.tipos : [contato.tipos || "Fornecedor"];
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .insert({
      owner_id: ownerId,
      nome: contato.nome,
      tipos,
      telefone: contato.telefone || null,
      email: contato.email || null,
      cpf_cnpj: contato.cpf_cnpj || null,
      pix: contato.pix || null,
      dados_bancarios: contato.dados_bancarios || null,
      observacoes: contato.observacoes || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
