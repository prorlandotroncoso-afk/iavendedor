const chat = document.getElementById("chat");

const userId = crypto.randomUUID();

async function sendMessage() {

  const input = document.getElementById("message");

  const text = input.value;

  if (!text) return;

  addMessage(text, "user");

  input.value = "";

  const response = await fetch("/chat", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      message: text,
      userId: userId,
    }),
  });

  const data = await response.json();

  addMessage(data.reply, "bot");
}

function addMessage(text, type) {

  const div = document.createElement("div");

  div.classList.add("message");
  div.classList.add(type);

  div.innerText = text;

  chat.appendChild(div);

  chat.scrollTop = chat.scrollHeight;
}