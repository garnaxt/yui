const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require("discord.js");
const { REST } = require("@discordjs/rest");
const fs = require("fs");

// =============== CONFIG =================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const MISSION_CHANNEL_ID = process.env.MISSION_CHANNEL_ID;
const MISSION_MANAGER_ROLE = "Mission Manager";
// =======================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ---------- Load Missions ----------
let missions = {};
try {
  if (fs.existsSync("missions.json")) {
    const raw = fs.readFileSync("missions.json", "utf8").trim();
    missions = raw ? JSON.parse(raw) : {};
  }
} catch {
  missions = {};
  fs.writeFileSync("missions.json", "{}");
}

// ---------- Slash Commands ----------
const commands = [
  new SlashCommandBuilder()
    .setName("mission")
    .setDescription("Mission management")
    .addSubcommand(sub =>
      sub
        .setName("create")
        .setDescription("Create a mission")
        .addStringOption(o =>
          o.setName("name").setDescription("Mission name").setRequired(true)
        )
        .addStringOption(o =>
          o.setName("description").setDescription("Mission description").setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName("max_accepts").setDescription("Max accepts (0 = unlimited)").setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName("rank")
            .setDescription("Mission rank")
            .setRequired(true)
            .addChoices(
              { name: "E", value: "E" },
              { name: "D", value: "D" },
              { name: "C", value: "C" },
              { name: "B", value: "B" },
              { name: "A", value: "A" },
              { name: "S", value: "S" },
              { name: "N", value: "N" },
              { name: "?", value: "?" }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName("complete").setDescription("Complete a mission")
    )
    .addSubcommand(sub =>
      sub.setName("fail").setDescription("Fail a mission taker")
    ),

  new SlashCommandBuilder()
    .setName("missions")
    .setDescription("Mission info")
    .addSubcommand(sub =>
      sub.setName("my").setDescription("View your missions")
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
})();

// ---------- Ready ----------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------- Embed ----------
function buildMissionEmbed(m) {
  const accepted =
    m.acceptedBy.length === 0 ? "—" : m.acceptedBy.map(id => `<@${id}>`).join("\n");

  const limit =
    m.maxAccepts === 0 ? "∞" : `${m.acceptedBy.length}/${m.maxAccepts}`;

  return new EmbedBuilder()
    .setTitle(`📜 ${m.name}`)
    .setDescription(m.description)
    .addFields(
      { name: "🏷 Rank", value: m.rank, inline: true },
      { name: "📌 Status", value: m.completed ? "✅ Completed" : "🟢 Active", inline: true },
      { name: "🎯 Slots", value: limit, inline: true },
      { name: "👥 Accepted By", value: accepted }
    )
    .setColor(m.completed ? 0xe74c3c : 0x2ecc71)
    .setFooter({ text: "Mission Board" })
    .setTimestamp();
}

// ---------- Interactions ----------
client.on("interactionCreate", async interaction => {

  // ===== /mission =====
  if (interaction.isChatInputCommand() && interaction.commandName === "mission") {
    if (!interaction.inGuild()) return interaction.reply({ content: "Server only.", ephemeral: true });

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const isManager = member.roles.cache.some(r => r.name === MISSION_MANAGER_ROLE);

    // ----- CREATE -----
    if (interaction.options.getSubcommand() === "create") {
      if (!isManager) return interaction.reply({ content: "Manager only.", ephemeral: true });

      const mission = {
        name: interaction.options.getString("name"),
        description: interaction.options.getString("description"),
        rank: interaction.options.getString("rank"),
        maxAccepts: interaction.options.getInteger("max_accepts"),
        acceptedBy: [],
        completedBy: [],
        failedBy: [],
        completed: false
      };

      const msg = await client.channels.fetch(MISSION_CHANNEL_ID).then(c =>
        c.send({
          embeds: [buildMissionEmbed(mission)],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`accept_${mission.name}`)
                .setLabel("Accept Mission")
                .setStyle(ButtonStyle.Primary)
            )
          ]
        })
      );

      mission.messageId = msg.id;
      missions[mission.name] = mission;
      fs.writeFileSync("missions.json", JSON.stringify(missions, null, 2));
      return interaction.reply({ content: "✅ Mission posted.", ephemeral: true });
    }

    // ----- COMPLETE -----
    if (interaction.options.getSubcommand() === "complete") {
      if (!isManager) return interaction.reply({ content: "Manager only.", ephemeral: true });

      const active = Object.values(missions).filter(m => !m.completed);
      if (!active.length) return interaction.reply({ content: "No active missions.", ephemeral: true });

      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("complete_mission")
              .setPlaceholder("Select mission")
              .addOptions(active.map(m => ({
                label: m.name,
                value: m.name,
                description: `Rank ${m.rank}`
              })))
          )
        ]
      });
    }

    // ----- FAIL (STEP 1) -----
    if (interaction.options.getSubcommand() === "fail") {
      if (!isManager) return interaction.reply({ content: "Manager only.", ephemeral: true });

      const valid = Object.values(missions).filter(m => !m.completed && m.acceptedBy.length);
      if (!valid.length) return interaction.reply({ content: "No valid missions.", ephemeral: true });

      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("fail_mission_select")
              .setPlaceholder("Select mission")
              .addOptions(valid.map(m => ({ label: m.name, value: m.name })))
          )
        ]
      });
    }
  }

  // ===== FAIL STEP 2 =====
  if (interaction.isStringSelectMenu() && interaction.customId === "fail_mission_select") {
    const m = missions[interaction.values[0]];

    return interaction.update({
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`fail_user_${m.name}`)
            .setPlaceholder("Select user to fail")
            .addOptions(
              m.acceptedBy.map(id => ({
                label: interaction.guild.members.cache.get(id)?.user.username || id,
                value: id
              }))
            )
        )
      ]
    });
  }

  // ===== FAIL FINAL =====
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("fail_user_")) {
    const name = interaction.customId.replace("fail_user_", "");
    const m = missions[name];
    const userId = interaction.values[0];

    m.acceptedBy = m.acceptedBy.filter(id => id !== userId);
    m.failedBy.push(userId);
    fs.writeFileSync("missions.json", JSON.stringify(missions, null, 2));

    const msg = await client.channels.fetch(MISSION_CHANNEL_ID).then(c => c.messages.fetch(m.messageId));
    await msg.edit({ embeds: [buildMissionEmbed(m)] });

    return interaction.update({ content: `❌ <@${userId}> failed **${name}**.`, components: [] });
  }

  // ===== COMPLETE SELECT =====
  if (interaction.isStringSelectMenu() && interaction.customId === "complete_mission") {
    const m = missions[interaction.values[0]];
    m.completed = true;
    m.completedBy = [...m.acceptedBy];
    fs.writeFileSync("missions.json", JSON.stringify(missions, null, 2));

    const msg = await client.channels.fetch(MISSION_CHANNEL_ID).then(c => c.messages.fetch(m.messageId));
    await msg.edit({
      embeds: [buildMissionEmbed(m)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("Mission Completed")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
            .setCustomId("done")
        )
      ]
    });

    return interaction.reply({ content: `🏁 **${m.name}** completed.`, ephemeral: true });
  }

  // ===== ACCEPT =====
  if (interaction.isButton() && interaction.customId.startsWith("accept_")) {
    const name = interaction.customId.replace("accept_", "");
    const m = missions[name];

    if (m.completed) return interaction.reply({ content: "Mission completed.", ephemeral: true });
    if (m.acceptedBy.includes(interaction.user.id)) return interaction.reply({ content: "Already accepted.", ephemeral: true });
    if (m.maxAccepts !== 0 && m.acceptedBy.length >= m.maxAccepts) return interaction.reply({ content: "Mission full.", ephemeral: true });

    m.acceptedBy.push(interaction.user.id);
    fs.writeFileSync("missions.json", JSON.stringify(missions, null, 2));

    const msg = await client.channels.fetch(MISSION_CHANNEL_ID).then(c => c.messages.fetch(m.messageId));
    await msg.edit({ embeds: [buildMissionEmbed(m)] });

    return interaction.reply({ content: "Mission accepted.", ephemeral: true });
  }

  // ===== /missions my =====
  if (interaction.isChatInputCommand() && interaction.commandName === "missions") {
    const id = interaction.user.id;
    const active = [];
    const completed = [];

    for (const m of Object.values(missions)) {
      if (m.acceptedBy.includes(id) && !m.completed) active.push(m.name);
      if (m.completedBy.includes(id)) completed.push(m.name);
    }

    return interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle("📘 Your Missions")
          .addFields(
            { name: "🟢 Active", value: active.join("\n") || "—" },
            { name: "✅ Completed", value: completed.join("\n") || "—" }
          )
          .setColor(0x5865f2)
      ]
    });
  }
});

// ---------- Login ----------
client.login(TOKEN);
