import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { Client, Events, GatewayIntentBits } from "discord.js";
import fs from "fs";

import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const memory = z.object({
  memory: z.string(),
  lastUpdated: z.string(),
  expiresOn: z.string().nullable(),
  title: z.string(),
});

const MessageEvent = z.object({
  messageExplanation: z.string(),
  memory: z.array(memory),
  message: z.string(),
});

const backstoryTxt = fs.readFileSync("./promptContent/backstory.txt", "utf-8");

const memoriesFileName = "./promptContent/memory.json";

// Array of strings separated by newlines
const backstoryJSON = backstoryTxt.split("\n");

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Indicate typing
  await message.channel.sendTyping();

  // Get last 10 messages
  const messages = await message.channel.messages.fetch({
    limit: 10,
  });

  const messageHistory = messages.map((message) => ({
    user: message.author.username,
    content: message.content,
    // Date string
    messageTime: new Date(message.createdTimestamp).toDateString(),
    messageAge: ageInMillisecondsToHumanReadable(
      Date.now() - message.createdTimestamp
    ),
    containsImage: message.attachments.size > 0,
  }));

  messageHistory.reverse();

  if (!fs.existsSync(memoriesFileName)) {
    fs.writeFileSync(memoriesFileName, "[]");
  }

  const memoriesTxt = fs.readFileSync(memoriesFileName, "utf-8");

  let memories = JSON.parse(memoriesTxt);

  // Filter out memories that are too old
  memories = memories.filter((memory: any) => {
    const expiresOn = new Date(memory.expiresOn);
    return expiresOn > new Date();
  });

  const prompt = `Please write a message as "Stefan", responding to the following messages: ${JSON.stringify(
    messageHistory
  )}

  Write about one or two sentences.

  You can ignore messages that are clearly too old for this conversation.

  Use the memory for remembering things not in the backstory. Return a full array of memories you want to keep, and discard memories that are too old based on lastUpdated. Dates should be in the format "YYYY-MM-DD"

  Here is Stefan's memory: ${JSON.stringify(memories)}

  Here is Stefan's backstory: ${JSON.stringify(backstoryJSON)}

  You don't have to mention things from either the backstory or the memory if it isn't relevant to the conversation.

  You can't see images, but you know if the message contains an image.

  Today is ${new Date().toDateString()}
  `;

  const response = await openai.responses.parse({
    model: "gpt-4o",
    input: [
      {
        role: "user",
        content: prompt,
      },
    ],
    text: {
      format: zodTextFormat(MessageEvent, "message"),
    },
  });

  if (response.output_parsed) {
    await message.reply(response.output_parsed.message);

    let memories = response.output_parsed.memory;

    console.log(memories);

    // Write to memory.txt
    fs.writeFileSync(memoriesFileName, JSON.stringify(memories, null, 2));
  } else {
    await message.reply("Something went wrong");
  }
});

function ageInMillisecondsToHumanReadable(time: number) {
  const days = Math.floor(time / (1000 * 60 * 60 * 24));
  const hours = Math.floor((time % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((time % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((time % (1000 * 60)) / 1000);

  return `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`;
}

client.login(process.env.DISCORD_BOT_TOKEN);
