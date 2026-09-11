const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const telegramBotToken = defineSecret("TELEGRAM_BOT_TOKEN");
const telegramChatId = defineSecret("TELEGRAM_CHAT_ID");

exports.sendTelegramForNewTicket = onDocumentCreated(
  {
    document: "tickets/{ticketId}",
    region: "asia-southeast1",
    secrets: [telegramBotToken, telegramChatId],
  },
  async (event) => {
    const ticket = event.data && event.data.data();

    if (!ticket) {
      logger.warn("Ticket create event had no data.", {
        ticketId: event.params.ticketId,
      });
      return;
    }

    const token = telegramBotToken.value();
    const chatId = telegramChatId.value();
    const photoUrls = Array.isArray(ticket.photos) ? ticket.photos : [];
    const machine = ticket.machine || {};

    const caption =
      `New Maintenance Ticket\n\n` +
      `Ticket: ${ticket.ticketId || event.params.ticketId}\n` +
      `Machine: ${machine.id || "-"} - ${machine.name || "-"}\n` +
      `Location: ${machine.location || "-"}\n` +
      `Reported by: ${ticket.employeeName || "-"}\n\n` +
      `Problem:\n${ticket.problemDescription || "-"}\n\n` +
      `Link:\nhttps://lover0sie.github.io/Maint-Jig-Ticketing-System/maintenance-login.html`;

    const endpoint = photoUrls.length > 0 ? "sendPhoto" : "sendMessage";
    const payload =
      photoUrls.length > 0
        ? {
            chat_id: chatId,
            photo: photoUrls[0],
            caption,
          }
        : {
            chat_id: chatId,
            text: caption,
          };

    const res = await fetch(
      `https://api.telegram.org/bot${token}/${endpoint}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const data = await res.json();

    if (!data.ok) {
      logger.error("Telegram send failed.", {
        ticketId: event.params.ticketId,
        description: data.description,
      });
      throw new Error(data.description || "Telegram send failed");
    }

    logger.info("Telegram notification sent.", {
      ticketId: event.params.ticketId,
      endpoint,
    });
  }
);
