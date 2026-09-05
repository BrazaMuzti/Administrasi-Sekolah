// Edge Function: buat-akun
// Satu-satunya pintu untuk membuat/mengubah/menghapus user Auth + profil tabel 'akun'.
// Hanya user dengan akun.tipe = 'admin' yang boleh memanggil.
//
// Actions:
//   buat_akun   → user Auth baru + profil (tipe: admin/guru/murid)
//   update_akun → edit profil + opsional reset password
//   hapus_akun  → hapus user Auth + profil (dukung baris lama unlinked)
//
// Deploy:
//   npx supabase functions deploy buat-akun --project-ref <PROJECT_REF>
//
// Env otomatis di hosting Supabase:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const TIPE_VALID = ["admin", "guru", "murid"];

/** Susun objek kolom profil tabel 'akun' dari body request.
 *  Hanya field yang ada di body yang dimasukkan (undefined = jangan ubah). */
function susunProfil(body: Record<string, unknown>) {
  const profil: Record<string, unknown> = {};
  if (body.email !== undefined) profil.email = String(body.email).trim().toLowerCase();
  if (body.nama_lengkap !== undefined) profil.nama_lengkap = String(body.nama_lengkap).trim();
  if (body.nis_nip !== undefined) profil.nis_nip = String(body.nis_nip).trim();
  if (body.jabatan !== undefined) profil.jabatan = String(body.jabatan).trim();
  if (body.tingkat_kelas !== undefined) profil.tingkat_kelas = String(body.tingkat_kelas).trim();
  if (body.mapel !== undefined) profil.mapel = String(body.mapel).trim();
  if (body.ekstrakurikuler !== undefined) {
    profil.ekstrakurikuler = String(body.ekstrakurikuler).trim();
  }
  if (body.no_telepon !== undefined) profil.no_telepon = String(body.no_telepon).trim();
  if (body.wali_kelas !== undefined) profil.wali_kelas = String(body.wali_kelas).trim();
  if (body.gelar_depan !== undefined) profil.gelar_depan = String(body.gelar_depan).trim();
  if (body.gelar_belakang !== undefined) profil.gelar_belakang = String(body.gelar_belakang).trim();
  return profil;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ status: "error", message: "Token tidak ditemukan." }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Verifikasi identitas pemanggil (token milik user yang login)
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: me, error: meErr } = await authClient.auth.getUser();
    if (meErr || !me?.user) {
      return json({ status: "error", message: "Token tidak valid." }, 401);
    }

    // 2. Client service_role untuk operasi admin
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 3. Pemanggil harus admin (cek tabel 'akun')
    const { data: caller } = await admin
      .from("akun")
      .select("tipe")
      .eq("user_id", me.user.id)
      .maybeSingle();
    if (!caller || caller.tipe !== "admin") {
      return json(
        { status: "error", message: "Hanya admin yang boleh mengelola akun." },
        403,
      );
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "buat_akun");

    // ================== BUAT AKUN ==================
    if (action === "buat_akun") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const tipe = String(body.tipe ?? "admin");
      const nama = String(body.nama_lengkap ?? "").trim();
      const nisNip = String(body.nis_nip ?? "").trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ status: "error", message: "Format email tidak valid." }, 400);
      }
      if (password.length < 6) {
        return json({ status: "error", message: "Password minimal 6 karakter." }, 400);
      }
      if (!TIPE_VALID.includes(tipe)) {
        return json({ status: "error", message: "Tipe harus admin/guru/murid." }, 400);
      }
      if (tipe !== "admin" && !nisNip) {
        return json({ status: "error", message: "NIS/NIP wajib untuk guru & murid." }, 400);
      }

      // 4. Buat user di Supabase Auth (bukan tabel!) — password di-hash oleh Auth
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nama_lengkap: nama, tipe },
      });
      if (createErr) {
        const pesan = createErr.message.includes("already been registered")
          ? "Email sudah terdaftar di Supabase Auth."
          : createErr.message;
        return json({ status: "error", message: pesan }, 400);
      }

      // 5. Buat / tautkan baris profil di tabel 'akun'
      const profil: Record<string, unknown> = {
        ...susunProfil(body),
        user_id: created.user.id,
        tipe,
      };
      profil.email = email;
      profil.nama_lengkap = nama;
      profil.nis_nip = nisNip;

      const { data: existing } = await admin
        .from("akun")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      const { error: profErr } = existing
        ? await admin.from("akun").update(profil).eq("id", existing.id)
        : await admin.from("akun").insert(profil);

      if (profErr) {
        // Rollback: jangan tinggalkan user Auth yatim tanpa profil
        await admin.auth.admin.deleteUser(created.user.id);
        return json(
          { status: "error", message: "Profil gagal disimpan: " + profErr.message },
          500,
        );
      }

      return json({
        status: "success",
        message: `Akun ${email} (${tipe}) berhasil dibuat.`,
      });
    }

    // ================== UPDATE AKUN ==================
    if (action === "update_akun") {
      const userId = String(body.user_id ?? "").trim();
      if (!userId) {
        return json({ status: "error", message: "user_id wajib diisi." }, 400);
      }

      // 6. Reset password (opsional) via admin API
      if (body.password !== undefined && body.password !== "") {
        const newPass = String(body.password);
        if (newPass.length < 6) {
          return json({ status: "error", message: "Password minimal 6 karakter." }, 400);
        }
        const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
          password: newPass,
        });
        if (pwErr) {
          return json(
            { status: "error", message: "Reset password gagal: " + pwErr.message },
            400,
          );
        }
      }

      // 7. Update profil tabel 'akun' (opsional)
      const profil = susunProfil(body);
      delete profil.email; // ganti email = operasi berisiko (dipakai sebagai identifier login)
      if (Object.keys(profil).length > 0) {
        const { error: profErr } = await admin
          .from("akun")
          .update(profil)
          .eq("user_id", userId);
        if (profErr) {
          return json(
            { status: "error", message: "Profil gagal diubah: " + profErr.message },
            500,
          );
        }
      }

      return json({ status: "success", message: "Perubahan berhasil disimpan." });
    }

    // ================== HAPUS AKUN ==================
    if (action === "hapus_akun") {
      const userId = String(body.user_id ?? "").trim();
      const profilId = String(body.profil_id ?? "").trim();
      if (!userId && !profilId) {
        return json({ status: "error", message: "user_id atau profil_id wajib diisi." }, 400);
      }
      if (userId && userId === me.user.id) {
        return json({ status: "error", message: "Tidak dapat menghapus akun sendiri." }, 400);
      }

      // 8. Cari profil (via user_id, atau baris lama yang belum tertaut via profil_id)
      type BarisAkun = { tipe?: string; email?: string; user_id?: string };
      let target: BarisAkun | null = null;
      if (userId) {
        const { data } = await admin
          .from("akun")
          .select("tipe, email")
          .eq("user_id", userId)
          .maybeSingle();
        target = data;
      } else if (profilId) {
        const { data } = await admin
          .from("akun")
          .select("tipe, email, user_id")
          .eq("id", profilId)
          .maybeSingle();
        target = data;
        if (target?.user_id) {
          return json(
            { status: "error", message: "Baris ini sudah tertaut user Auth — kirim user_id." },
            400,
          );
        }
      }
      if (!target) {
        return json({ status: "error", message: "Akun tidak ditemukan." }, 404);
      }

      // 9. Cegah menghapus admin terakhir
      if (target.tipe === "admin") {
        const { count } = await admin
          .from("akun")
          .select("id", { count: "exact", head: true })
          .eq("tipe", "admin");
        if ((count ?? 0) <= 1) {
          return json({ status: "error", message: "Minimal harus ada satu admin." }, 400);
        }
      }

      // 10. Hapus user Auth (jika tertaut) lalu profil
      if (userId) {
        await admin.auth.admin.deleteUser(userId);
        const { error: delErr } = await admin.from("akun").delete().eq("user_id", userId);
        if (delErr) {
          return json({ status: "error", message: delErr.message }, 500);
        }
      } else if (profilId) {
        const { error: delErr } = await admin.from("akun").delete().eq("id", profilId);
        if (delErr) {
          return json({ status: "error", message: delErr.message }, 500);
        }
      }
      return json({ status: "success", message: `Akun ${target.email ?? ""} dihapus.` });
    }

    return json({ status: "error", message: "Action tidak dikenali." }, 400);
  } catch (e) {
    const pesan = e instanceof Error ? e.message : "Kesalahan server.";
    return json({ status: "error", message: pesan }, 500);
  }
});
