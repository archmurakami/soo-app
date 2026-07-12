import { requireSupabase } from "./supabase-client.js";

const TABLE = "obras";

export async function listarObras(ownerId) {
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function criarObra(ownerId, obra) {
  const payload = {
    owner_id: ownerId,
    nome: obra.nome,
    cliente: obra.cliente || null,
    cidade: obra.cidade || null,
    data_inicio: obra.data_inicio || null,
    status: obra.status || "ativa"
  };

  const { data, error } = await requireSupabase()
    .from(TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}
