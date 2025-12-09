let qrAlreadyGenerated = false; // Controla se o QR já foi gerado

async function waitForConnection() {
  const qrContainer = document.getElementById("qr");

  // 1️⃣ Gera o QR Code apenas uma vez
  if (!qrAlreadyGenerated) {
    try {
      const qrRes = await fetch("/qr");
      if (qrRes.ok) {
        const { qr } = await qrRes.json();
        const qrImage = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
          qr
        )}`;
        qrContainer.innerHTML = `<img src="${qrImage}" alt="QR Code">`;
        qrAlreadyGenerated = true;
      } else {
        qrContainer.innerHTML = "<p>QR ainda não disponível...</p>";
      }
    } catch (err) {
      console.error("Erro ao buscar QR:", err);
    }
  }

  // 2️⃣ Loop apenas para verificar conexão (sem atualizar QR)
  while (true) {
    try {
      const statusRes = await fetch("/status");
      const { status } = await statusRes.json();

      if (status === "conectado") {
        // Redireciona assim que estiver conectado
        window.location.href = "index.html";
        return;
      }

      // Se ainda não gerou o QR, tenta gerar
      if (!qrAlreadyGenerated) {
        const qrRes = await fetch("/qr");
        if (qrRes.ok) {
          const { qr } = await qrRes.json();
          const qrImage = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
            qr
          )}`;
          qrContainer.innerHTML = `<img src="${qrImage}" alt="QR Code">`;
          qrAlreadyGenerated = true;
        }
      }
    } catch (err) {
      console.error("Erro ao buscar status:", err);
    }

    // 3️⃣ Espera 2 segundos antes de checar novamente
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// Inicia a função
waitForConnection();
