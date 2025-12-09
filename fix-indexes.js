// Script para corrigir índices do banco de dados
require("dotenv").config();
require("./database.js");
const mongoose = require("mongoose");

async function fixIndexes() {
  try {
    console.log("🔧 Corrigindo índices do banco de dados...");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    // Lista todos os índices
    const indexes = await usersCollection.indexes();
    console.log("\n📋 Índices atuais:");
    indexes.forEach((index) => {
      console.log(`  - ${index.name}:`, index.key);
    });

    // Remove índice antigo 'number_1' se existir
    try {
      await usersCollection.dropIndex("number_1");
      console.log("\n✅ Índice 'number_1' removido");
    } catch (err) {
      console.log("\n⚠️ Índice 'number_1' não existe (ok)");
    }

    // Cria índice único para 'email'
    try {
      await usersCollection.createIndex({ email: 1 }, { unique: true });
      console.log("✅ Índice único 'email_1' criado");
    } catch (err) {
      console.log("⚠️ Índice 'email_1' já existe (ok)");
    }

    // Remove o campo 'number' de todos os documentos
    const result = await usersCollection.updateMany(
      { number: { $exists: true } },
      { $unset: { number: "" } }
    );

    console.log(
      `\n✅ Campo 'number' removido de ${result.modifiedCount} documentos`
    );

    // Lista índices finais
    const finalIndexes = await usersCollection.indexes();
    console.log("\n📋 Índices finais:");
    finalIndexes.forEach((index) => {
      console.log(`  - ${index.name}:`, index.key);
    });

    console.log("\n🎉 Correção concluída!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro:", err);
    process.exit(1);
  }
}

mongoose.connection.once("open", () => {
  console.log("✅ Conectado ao MongoDB");
  fixIndexes();
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Erro ao conectar no MongoDB:", err);
  process.exit(1);
});
