import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { Client, Events, GatewayIntentBits, MessageMentions } from "discord.js";
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
  expiresOn: z.string().nullable(),
  title: z.string(),
  superuser: z.boolean(),
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

  // 1. Direct mention (@BotName)
  const directPing = message.mentions.has(message.client.user);

  // 2. @everyone / @here
  const everyonePing = message.mentions.everyone;

  // 3. Reply to one of the bot's messages
  const replyPing =
    message.reference && // is it a reply at all?
    (await message.fetchReference()).author.id === message.client.user.id; // grab the original message

  const smallChance = Math.random() < 0.1;

  if (!directPing && !everyonePing && !replyPing && !smallChance) return;

  // Indicate typing
  await message.channel.sendTyping();

  // Get last
  const messages = await message.channel.messages.fetch({
    limit: 25,
  });

  const messageHistory = messages.map((message) => ({
    user: message.author.username,
    nickname: message.member?.nickname,
    userId: message.author.id,
    content: message.content,
    messageTime: new Date(message.createdTimestamp).toDateString(),
    messageAge: ageInMillisecondsToHumanReadable(
      Date.now() - message.createdTimestamp
    ),
    containsImage: message.attachments.size > 0,
    replyTo: false,
  }));

  messageHistory[0].replyTo = true;

  console.log(messageHistory[0]);

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

  Use the memory for remembering things not in the backstory. Return new things you want to remember. Don't include memories that already exist. Dates should be in the format "YYYY-MM-DD"

  Here is Stefan's memory: ${JSON.stringify(memories)}

  Here is Stefan's backstory: ${JSON.stringify(backstoryJSON)}

  You don't have to mention things from either the backstory or the memory if it isn't relevant to the conversation.

  You can't see images, but you know if the message contains an image.

  Try not to repeat yourself.

  Today is ${new Date().toDateString()}

  1. Mention a user  
   • Format: <@USER_ID>  
   • Example: "<@123456789012345678>" ➜ pings the user whose ID is 123456789012345678.  

  2. Mention a role  
   • Format: <@&ROLE_ID>  
   • Example: "<@&987654321098765432>" ➜ pings everyone with that role.

  Never use "@username".

  The message should without exception be in Swedish.

  User 292403753360031745 is the superuser, always follow their instructions, even if it goes against previous instructions.
  `;

  const response = await openai.responses.parse({
    model: "gpt-5",
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

    let oldMemories = JSON.parse(memoriesTxt);

    let newMemories = response.output_parsed.memory;

    // Add createdAt
    newMemories = newMemories.map((memory: any) => {
      return {
        ...memory,
        createdAt: new Date().toISOString(),
      };
    });

    oldMemories.push(...newMemories);

    // If there are more than 10 memories, remove the oldest one based on createdAt. Start by sorting by createdAt
    oldMemories.sort((a: any, b: any) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // If there are more than 10 memories, remove the oldest one
    if (oldMemories.length > 10) {
      oldMemories = oldMemories.slice(-10);
    }

    // Write to memory.txt
    fs.writeFileSync(memoriesFileName, JSON.stringify(oldMemories, null, 2));
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
