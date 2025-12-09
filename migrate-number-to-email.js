// Script de migração: converte campo 'number' para 'email' no User
require("dotenv").config();
require("./database.js");
const mongoose = require("mongoose");

// Schema temporário com ambos os campos
const UserSchema = new mongoose.Schema(
  {
    username: String,
    number: String,
    email: String,
    password: String,
    role: [Number],
  },
  { timestamps: true, strict: false }
);

const User = mongoose.model("User", UserSchema);

async function migrate() {
  try {
    console.log("🔄 Iniciando migração de 'number' para 'email'...");

    // 1. Remove o índice único do campo 'number'
    try {
      await User.collection.dropIndex("number_1");
      console.log("✅ Índice 'number_1' removido");
    } catch (err) {
      if (err.code === 27) {
        console.log("⚠️ Índice 'number_1' já foi removido anteriormente");
      } else {
        console.log(
          "⚠️ Erro ao remover índice (pode já ter sido removido):",
          err.message
        );
      }
    }

    // 2. Busca todos os usuários que têm 'number' mas não têm 'email'
    const usersToMigrate = await User.find({
      number: { $exists: true },
      email: { $exists: false },
    });

    console.log(`📊 Encontrados ${usersToMigrate.length} usuários para migrar`);

    if (usersToMigrate.length === 0) {
      console.log("✅ Nenhum usuário precisa ser migrado");
      process.exit(0);
    }

    // 3. Migra cada usuário
    for (const user of usersToMigrate) {
      // Copia 'number' para 'email' e remove 'number'
      await User.updateOne(
        { _id: user._id },
        {
          $set: { email: user.number },
          $unset: { number: "" },
        }
      );

      console.log(`✅ Migrado: ${user.username} (${user.number})`);
    }

    console.log("\n🎉 Migração concluída com sucesso!");
    console.log(`✅ ${usersToMigrate.length} usuários migrados`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Erro na migração:", err);
    process.exit(1);
  }
}

// Aguarda conexão com o banco
mongoose.connection.once("open", () => {
  console.log("✅ Conectado ao MongoDB");
  migrate();
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Erro ao conectar no MongoDB:", err);
  process.exit(1);
});
