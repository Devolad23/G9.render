const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, SlashCommandBuilder, REST, Routes } = require('discord.js');
const tokens = require('./tokens');

// إعداد العميل للبوتات
const createBotClient = (intents = []) => {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMessageReactions,
            ...intents
        ]
    });
};

// بوت التذاكر (Tickets)
const ticketBot = createBotClient();
ticketBot.commands = new Collection();
ticketBot.activeTickets = new Collection();
ticketBot.adminRoles = new Collection(); // لحفظ رتب مشرفين التذاكر
ticketBot.logChannels = new Collection(); // لحفظ رومز سجلات التذاكر
ticketBot.cooldowns = new Map(); // لمنع الضغط المتكرر
ticketBot.rateLimiter = new Map(); // حماية إضافية من rate limiting
ticketBot.retryQueue = new Map(); // قائمة إعادة المحاولة

// بوت التقييمات
const reviewBot = createBotClient();
reviewBot.reviewStats = new Collection();
reviewBot.reviewChannels = new Collection(); // لحفظ الرومز المخصصة للتقييم
reviewBot.rateLimiter = new Map(); // حماية من rate limiting
reviewBot.retryQueue = new Map(); // قائمة إعادة المحاولة

// دوال الحماية من الحظر
const checkRateLimit = (bot, userId, action, limitMs = 5000) => {
    const key = `${userId}-${action}`;
    const now = Date.now();
    const lastAction = bot.rateLimiter.get(key);
    
    if (lastAction && (now - lastAction) < limitMs) {
        return true; // محظور مؤقتاً
    }
    
    bot.rateLimiter.set(key, now);
    setTimeout(() => bot.rateLimiter.delete(key), limitMs);
    return false;
};

const retryWithDelay = async (fn, maxRetries = 3, delay = 1000) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (error.code === 'RATE_LIMITED' || error.status === 429) {
                const waitTime = delay * Math.pow(2, i); // exponential backoff
                console.log(`معدل الاستخدام مرتفع، انتظار ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            if (i === maxRetries - 1) throw error;
        }
    }
};

const validateData = (data) => {
    if (!data) return false;
    if (typeof data === 'string' && data.trim().length === 0) return false;
    if (typeof data === 'object' && Object.keys(data).length === 0) return false;
    return true;
};

// دالة إرسال سجلات التذاكر مع حماية إضافية
const sendTicketLog = async (ticketChannel, closedBy, action) => {
    try {
        const guildId = ticketChannel.guild.id;
        const logChannelId = ticketBot.logChannels.get(guildId);
        
        if (!logChannelId) return; // لا يوجد روم سجلات محدد
        
        const logChannel = ticketChannel.guild.channels.cache.get(logChannelId);
        if (!logChannel) return; // روم السجلات غير موجود
        
        // جمع آخر 50 رسالة من التذكرة
        const messages = await ticketChannel.messages.fetch({ limit: 50 });
        const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        
        // إنشاء ملخص المحادثة
        let conversation = '';
        sortedMessages.forEach(msg => {
            if (msg.author.bot && msg.embeds.length > 0) {
                // تخطي رسائل البوت مع embeds
                return;
            }
            const timestamp = new Date(msg.createdTimestamp).toLocaleString('ar-SA');
            conversation += `[${timestamp}] ${msg.author.username}: ${msg.content || '[مرفق/embed]'}\n`;
        });
        
        // قص المحادثة إذا كانت طويلة جداً
        if (conversation.length > 4000) {
            conversation = conversation.substring(0, 4000) + '\n... (تم قص الرسائل الطويلة)';
        }
        
        const logEmbed = new EmbedBuilder()
            .setTitle('📋 سجل تذكرة')
            .addFields(
                { name: 'اسم التذكرة:', value: ticketChannel.name, inline: true },
                { name: 'الإجراء:', value: action, inline: true },
                { name: 'تم بواسطة:', value: `<@${closedBy.id}>`, inline: true },
                { name: 'التاريخ والوقت:', value: new Date().toLocaleString('ar-SA'), inline: false },
                { name: 'المحادثة:', value: conversation.length > 0 ? `\`\`\`\n${conversation}\n\`\`\`` : 'لا توجد رسائل', inline: false }
            )
            .setColor(0xe74c3c)
            .setTimestamp();
        
        await retryWithDelay(async () => {
            await logChannel.send({ embeds: [logEmbed] });
        });
    } catch (error) {
        console.error('خطأ في إرسال سجل التذكرة:', error);
    }
};

// وظائف مساعدة للتذاكر
const createTicketMainEmbed = () => {
    return new EmbedBuilder()
        .setTitle('افتح تذكرتك واختار مايناسبك')
        .setDescription('فتح تذكرة من هنا')
        .setImage('attachment://qren-store-logo.png')
        .setColor(0x000000)
        .setTimestamp();
};

const createTicketOptionsEmbed = () => {
    return new EmbedBuilder()
        .setTitle('فتح تذكرة من هنا')
        .setColor(0x2F3136);
};

const createTicketEmbed = (ticketType, description, user) => {
    const embed = new EmbedBuilder()
        .setTitle(`🎫 تذكرة جديدة - ${ticketType}`)
        .setDescription(description)
        .addFields(
            { name: 'نوع التذكرة:', value: ticketType, inline: true },
            { name: 'المستخدم:', value: `<@${user.id}>`, inline: true },
            { name: 'التاريخ:', value: new Date().toLocaleString('ar-SA'), inline: true }
        )
        .setColor(0x00AE86)
        .setImage('attachment://qren-store-logo.png')
        .setTimestamp()
        .setFooter({ text: 'نظام التذاكر' });
    
    return embed;
};

// وظائف مساعدة للتقييمات
const createReviewEmbed = (rating, reviewerUser, reviewId, reviewCount) => {
    const stars = '⭐'.repeat(Math.max(1, Math.min(5, rating)));
    const currentDate = new Date().toLocaleString('ar-SA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    return new EmbedBuilder()
        .setTitle('شكرًا على التقييم!')
        .addFields(
            { name: 'رسالة التقييم:', value: 'تم', inline: false },
            { name: 'التقييم:', value: stars, inline: false },
            { name: 'رقم التقييم:', value: reviewId.toString(), inline: false },
            { name: 'المقيم:', value: `<@${reviewerUser.id}>`, inline: false },
            { name: 'تاريخ التقييم:', value: currentDate, inline: false }
        )
        .setColor(0x00AE86)
        .setFooter({ 
            text: 'جميع الحقوق محفوظة © devil', 
            iconURL: 'https://cdn.discordapp.com/attachments/your-attachment-url/nify-logo.png' 
        });
};

// إنشاء embed تقييم مع النص الأصلي
const createReviewEmbedWithText = (rating, reviewerUser, reviewId, reviewCount, originalText) => {
    const stars = '⭐'.repeat(Math.max(1, Math.min(5, rating)));
    const currentDate = new Date().toLocaleString('ar-SA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    return new EmbedBuilder()
        .setTitle('شكرًا على التقييم!')
        .addFields(
            { name: 'رسالة التقييم:', value: originalText || 'تم', inline: false },
            { name: 'التقييم:', value: stars, inline: false },
            { name: 'رقم التقييم:', value: reviewId.toString(), inline: false },
            { name: 'المقيم:', value: `<@${reviewerUser.id}>`, inline: false },
            { name: 'تاريخ التقييم:', value: currentDate, inline: false }
        )
        .setColor(0x00AE86)
        .setFooter({ 
            text: 'جميع الحقوق محفوظة © devil', 
            iconURL: 'https://cdn.discordapp.com/attachments/your-attachment-url/nify-logo.png' 
        });
};

// إنشاء الأزرار
const createTicketMainButton = () => {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('open_ticket_menu')
                .setLabel('فتح تذكرة من هنا')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫')
        );
    return row;
};

const createTicketOptionsButtons = () => {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_buy')
                .setLabel('شراء منتج')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_inquiry')
                .setLabel('استفسار')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_problem')
                .setLabel('لحل مشكلة')
                .setStyle(ButtonStyle.Secondary)
        );
    return row;
};

// إنشاء أزرار إدارة التذاكر
const createTicketManageButtons = () => {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('استلام التذكرة')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('👤'),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('قفل التذكرة')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );
    return row;
};

// إعداد slash commands للتذاكر
const ticketCommands = [
    new SlashCommandBuilder()
        .setName('تذكرة')
        .setDescription('فتح نظام التذاكر مع الأزرار التفاعلية'),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Open the ticket system with interactive buttons'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('عرض قائمة الأوامر المتاحة')
        .setDescriptionLocalizations({
            'en-US': 'Show available commands list'
        }),
    new SlashCommandBuilder()
        .setName('مشرفين_التذاكر')
        .setDescription('إضافة أو إزالة رتب مشرفين التذاكر')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('إضافة أو إزالة رتبة')
                .setRequired(true)
                .addChoices(
                    { name: 'إضافة', value: 'add' },
                    { name: 'إزالة', value: 'remove' },
                    { name: 'عرض القائمة', value: 'list' }
                )
        )
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('الرتبة المراد إضافتها أو إزالتها')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('ticket_admins')
        .setDescription('Add or remove ticket admin roles')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Add or remove role')
                .setRequired(true)
                .addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' },
                    { name: 'List', value: 'list' }
                )
        )
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to add or remove')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('سجلات_التذاكر')
        .setDescription('تحديد روم سجلات التذاكر')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('الروم الذي سيتم إرسال سجلات التذاكر فيه')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('ticket_logs')
        .setDescription('Set the channel for ticket logs')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel where ticket logs will be sent')
                .setRequired(true)
        )
];

// إعداد slash commands للتقييمات
const reviewCommands = [
    new SlashCommandBuilder()
        .setName('تقييم')
        .setDescription('إرسال تقييم بالنجوم')
        .addIntegerOption(option =>
            option.setName('rating')
                .setDescription('التقييم من 1 إلى 5 نجوم')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(5)
        ),
    new SlashCommandBuilder()
        .setName('review')
        .setDescription('Send a star rating')
        .addIntegerOption(option =>
            option.setName('rating')
                .setDescription('Rating from 1 to 5 stars')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(5)
        ),
    new SlashCommandBuilder()
        .setName('اختيار_روم_تقييم')
        .setDescription('اختيار الروم المخصص للتقييمات')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('الروم الذي سيتم تحويل الرسائل فيه إلى تقييمات')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('set_review_room')
        .setDescription('Set the room for automatic reviews')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel where messages will be converted to reviews')
                .setRequired(true)
        )
];

// تسجيل slash commands للتذاكر (للعمل في جميع السيرفرات)
async function registerTicketCommands() {
    try {
        if (tokens.REMINDER_BOT_TOKEN && ticketBot.user) {
            const rest = new REST({ version: '10' }).setToken(tokens.REMINDER_BOT_TOKEN);
            
            console.log('بدء تسجيل slash commands للتذاكر...');
            
            // تسجيل الأوامر عالمياً
            await rest.put(
                Routes.applicationCommands(ticketBot.user.id),
                { body: ticketCommands }
            );
            
            // تسجيل الأوامر لكل سيرفر موجود (لظهور فوري)
            const guilds = ticketBot.guilds.cache;
            for (const [guildId, guild] of guilds) {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(ticketBot.user.id, guildId),
                        { body: ticketCommands }
                    );
                    console.log(`✅ تم تسجيل slash commands للتذاكر في ${guild.name}`);
                } catch (guildError) {
                    console.error(`خطأ في تسجيل commands لسيرفر ${guild.name}:`, guildError.message);
                }
            }
            
            console.log('✅ تم تسجيل slash commands للتذاكر بنجاح');
        }
    } catch (error) {
        console.error('خطأ في تسجيل slash commands للتذاكر:', error);
    }
}

// تسجيل slash commands للتقييمات (للعمل في جميع السيرفرات)
async function registerReviewCommands() {
    try {
        if (tokens.REVIEW_BOT_TOKEN && reviewBot.user) {
            const rest = new REST({ version: '10' }).setToken(tokens.REVIEW_BOT_TOKEN);
            
            console.log('بدء تسجيل slash commands للتقييمات...');
            
            // تسجيل الأوامر عالمياً
            await rest.put(
                Routes.applicationCommands(reviewBot.user.id),
                { body: reviewCommands }
            );
            
            // تسجيل الأوامر لكل سيرفر موجود (لظهور فوري)
            const guilds = reviewBot.guilds.cache;
            for (const [guildId, guild] of guilds) {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(reviewBot.user.id, guildId),
                        { body: reviewCommands }
                    );
                    console.log(`✅ تم تسجيل slash commands للتقييمات في ${guild.name}`);
                } catch (guildError) {
                    console.error(`خطأ في تسجيل commands لسيرفر ${guild.name}:`, guildError.message);
                }
            }
            
            console.log('✅ تم تسجيل slash commands للتقييمات بنجاح');
        }
    } catch (error) {
        console.error('خطأ في تسجيل slash commands للتقييمات:', error);
    }
}

// بوت التذاكر
ticketBot.once('ready', async () => {
    console.log(`بوت التذاكر جاهز! مسجل باسم ${ticketBot.user.tag}`);
    await registerTicketCommands();
});

// معالجة slash commands للتذاكر
// منع معالجة interactions متعددة
const processedInteractions = new Set();

ticketBot.on('interactionCreate', async (interaction) => {
    // منع معالجة نفس interaction
    if (processedInteractions.has(interaction.id) || interaction.replied || interaction.deferred) {
        return;
    }
    
    // فحص rate limiting عام للحماية من الحظر
    if (checkRateLimit(ticketBot, interaction.user.id, 'interaction', 3000)) {
        try {
            await interaction.reply({ 
                content: 'يرجى الانتظار قليلاً قبل استخدام الأوامر مرة أخرى.', 
                ephemeral: true 
            });
        } catch (error) {
            console.log('تم تجاهل تفاعل مكرر لتجنب الحظر');
        }
        return;
    }
    
    processedInteractions.add(interaction.id);
    
    // تنظيف المعرفات القديمة كل دقيقة
    setTimeout(() => processedInteractions.delete(interaction.id), 60000);
    
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        try {
            switch (commandName) {
                case 'تذكرة':
                case 'ticket':
                    const mainEmbed = createTicketMainEmbed();
                    const mainButton = createTicketMainButton();
                    
                    try {
                        // إرسال الصورة مع الembed
                        const { AttachmentBuilder } = require('discord.js');
                        const attachment = new AttachmentBuilder('images/qren-store-logo.png', { name: 'qren-store-logo.png' });
                        
                        await retryWithDelay(async () => {
                            await interaction.reply({ 
                                embeds: [mainEmbed], 
                                components: [mainButton],
                                files: [attachment]
                            });
                        });
                    } catch (replyError) {
                        console.error('خطأ في الرد على أمر التذكرة:', replyError.message);
                    }
                    break;

                case 'help':
                    const helpEmbed = new EmbedBuilder()
                        .setTitle('📋 أوامر بوت التذاكر')
                        .setDescription(
                            `**الأوامر المتاحة:**\n\n` +
                            `\`/تذكرة\` - فتح نظام التذاكر\n` +
                            `\`/ticket\` - Open ticket system (English)\n` +
                            `\`/مشرفين_التذاكر\` - إدارة رتب مشرفين التذاكر\n` +
                            `\`/ticket_admins\` - Manage ticket admin roles (English)\n` +
                            `\`/سجلات_التذاكر\` - تحديد روم سجلات التذاكر\n` +
                            `\`/ticket_logs\` - Set ticket logs channel (English)\n` +
                            `\`/help\` - عرض هذه القائمة`
                        )
                        .setColor(0x3498db);
                    
                    try {
                        await retryWithDelay(async () => {
                            await interaction.reply({ embeds: [helpEmbed], flags: [64] });
                        });
                    } catch (replyError) {
                        console.error('خطأ في الرد على أمر المساعدة:', replyError.message);
                    }
                    break;
                    
                case 'مشرفين_التذاكر':
                case 'ticket_admins':
                    const action = interaction.options.getString('action');
                    const role = interaction.options.getRole('role');
                    const guildId = interaction.guild.id;
                    
                    // الحصول على قائمة الرتب المحفوظة للسيرفر
                    let adminRoles = ticketBot.adminRoles.get(guildId) || [];
                    
                    if (action === 'add') {
                        if (!role) {
                            await interaction.reply({ content: 'يجب تحديد الرتبة المراد إضافتها', flags: [64] });
                            break;
                        }
                        
                        if (adminRoles.includes(role.id)) {
                            try {
                                await interaction.reply({ content: `الرتبة ${role.name} موجودة بالفعل في قائمة مشرفين التذاكر`, flags: [64] });
                            } catch (e) { console.log('خطأ في الرد'); }
                            break;
                        }
                        
                        adminRoles.push(role.id);
                        ticketBot.adminRoles.set(guildId, adminRoles);
                        
                        const addEmbed = new EmbedBuilder()
                            .setTitle('✅ تم إضافة رتبة مشرف تذاكر')
                            .setDescription(`تم إضافة الرتبة ${role} إلى قائمة مشرفين التذاكر`)
                            .setColor(0x00AE86);
                        
                        try {
                            await retryWithDelay(async () => {
                                await interaction.reply({ embeds: [addEmbed], flags: [64] });
                            });
                        } catch (e) { console.log('خطأ في الرد'); }
                        
                    } else if (action === 'remove') {
                        if (!role) {
                            await interaction.reply({ content: 'يجب تحديد الرتبة المراد إزالتها', flags: [64] });
                            break;
                        }
                        
                        const roleIndex = adminRoles.indexOf(role.id);
                        if (roleIndex === -1) {
                            await interaction.reply({ content: `الرتبة ${role.name} غير موجودة في قائمة مشرفين التذاكر`, flags: [64] });
                            break;
                        }
                        
                        adminRoles.splice(roleIndex, 1);
                        ticketBot.adminRoles.set(guildId, adminRoles);
                        
                        const removeEmbed = new EmbedBuilder()
                            .setTitle('❌ تم إزالة رتبة مشرف تذاكر')
                            .setDescription(`تم إزالة الرتبة ${role} من قائمة مشرفين التذاكر`)
                            .setColor(0xe74c3c);
                        
                        try {
                            await retryWithDelay(async () => {
                                await interaction.reply({ embeds: [removeEmbed], flags: [64] });
                            });
                        } catch (e) { console.log('خطأ في الرد'); }
                        
                    } else if (action === 'list') {
                        if (adminRoles.length === 0) {
                            await interaction.reply({ content: 'لا توجد رتب مشرفين تذاكر محددة حالياً', flags: [64] });
                            break;
                        }
                        
                        const rolesList = adminRoles.map(roleId => {
                            const roleObj = interaction.guild.roles.cache.get(roleId);
                            return roleObj ? roleObj.toString() : `رتبة محذوفة (${roleId})`;
                        }).join('\n');
                        
                        const listEmbed = new EmbedBuilder()
                            .setTitle('👥 قائمة مشرفين التذاكر')
                            .setDescription(rolesList)
                            .setColor(0x3498db);
                        
                        try {
                            await retryWithDelay(async () => {
                                await interaction.reply({ embeds: [listEmbed], flags: [64] });
                            });
                        } catch (e) { console.log('خطأ في الرد'); }
                    }
                    break;
                    
                case 'سجلات_التذاكر':
                case 'ticket_logs':
                    const logChannel = interaction.options.getChannel('channel');
                    const logGuildId = interaction.guild.id;
                    
                    // حفظ الروم المخصص للسجلات
                    ticketBot.logChannels.set(logGuildId, logChannel.id);
                    
                    const logEmbed = new EmbedBuilder()
                        .setTitle('✅ تم تحديد روم سجلات التذاكر')
                        .setDescription(`تم تحديد ${logChannel} كروم لسجلات التذاكر.\nسيتم إرسال جميع سجلات التذاكر إلى هذا الروم.`)
                        .setColor(0x00AE86);
                    
                    try {
                        await retryWithDelay(async () => {
                            await interaction.reply({ embeds: [logEmbed], flags: [64] });
                        });
                    } catch (e) { console.log('خطأ في الرد'); }
                    break;
            }
        } catch (error) {
            console.error('خطأ في معالجة slash command:', error.message || error);
            // عدم الرد على الأخطاء لتجنب interaction acknowledged errors
        }
    } else if (interaction.isButton()) {
        try {
            switch (interaction.customId) {
                case 'open_ticket_menu':
                    const optionsEmbed = createTicketOptionsEmbed();
                    const optionsButtons = createTicketOptionsButtons();
                    
                    await interaction.update({ 
                        embeds: [optionsEmbed], 
                        components: [optionsButtons] 
                    });
                    break;

                case 'ticket_buy':
                    // فحص cooldown لمنع إنشاء تذاكر متعددة
                    const buyUserId = interaction.user.id;
                    const buyCooldownKey = `${buyUserId}-ticket`;
                    const buyNow = Date.now();
                    const buyCooldownAmount = 30000; // 30 ثانية للحماية من الحظر
                    
                    if (ticketBot.cooldowns.has(buyCooldownKey)) {
                        const buyExpirationTime = ticketBot.cooldowns.get(buyCooldownKey) + buyCooldownAmount;
                        
                        if (buyNow < buyExpirationTime) {
                            const buyTimeLeft = (buyExpirationTime - buyNow) / 1000;
                            await interaction.reply({ 
                                content: `يجب الانتظار ${buyTimeLeft.toFixed(1)} ثانية قبل إنشاء تذكرة جديدة.`, 
                                flags: [64] 
                            });
                            break;
                        }
                    }
                    
                    ticketBot.cooldowns.set(buyCooldownKey, buyNow);
                    setTimeout(() => ticketBot.cooldowns.delete(buyCooldownKey), buyCooldownAmount);
                    
                    // إنشاء روم تذكرة جديد
                    const guildAdminRoles = ticketBot.adminRoles.get(interaction.guild.id) || [];
                    const permissionOverwrites = [
                        {
                            id: interaction.guild.id,
                            deny: ['ViewChannel'],
                        },
                        {
                            id: interaction.user.id,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                        },
                    ];
                    
                    // إضافة رتب المشرفين
                    guildAdminRoles.forEach(roleId => {
                        permissionOverwrites.push({
                            id: roleId,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'],
                        });
                    });
                    
                    const buyChannel = await interaction.guild.channels.create({
                        name: `شراء-منتج-${interaction.user.username}`,
                        type: 0, // text channel
                        parent: null, // يمكن تحديد category إذا أردت
                        permissionOverwrites: permissionOverwrites,
                    });
                    
                    const buyEmbed = createTicketEmbed(
                        'شراء منتج',
                        'هذه التذكرة مخصصة لشراء المنتجات',
                        interaction.user
                    );
                    
                    // إرسال رسالة في الروم الجديد مع أزرار الإدارة
                    const buyManageButtons = createTicketManageButtons();
                    const buyAttachment = new AttachmentBuilder('images/qren-store-logo.png', { name: 'qren-store-logo.png' });
                    
                    await retryWithDelay(async () => {
                        await buyChannel.send({ embeds: [buyEmbed], components: [buyManageButtons], files: [buyAttachment] });
                    });
                    
                    await interaction.reply({ 
                        content: `تم إنشاء تذكرة شراء منتج في ${buyChannel}`, 
                        flags: [64] 
                    });
                    break;

                case 'ticket_inquiry':
                    // فحص cooldown لمنع إنشاء تذاكر متعددة
                    const inquiryUserId = interaction.user.id;
                    const inquiryCooldownKey = `${inquiryUserId}-ticket`;
                    const inquiryNow = Date.now();
                    const inquiryCooldownAmount = 30000; // 30 ثانية للحماية من الحظر
                    
                    if (ticketBot.cooldowns.has(inquiryCooldownKey)) {
                        const inquiryExpirationTime = ticketBot.cooldowns.get(inquiryCooldownKey) + inquiryCooldownAmount;
                        
                        if (inquiryNow < inquiryExpirationTime) {
                            const inquiryTimeLeft = (inquiryExpirationTime - inquiryNow) / 1000;
                            await interaction.reply({ 
                                content: `يجب الانتظار ${inquiryTimeLeft.toFixed(1)} ثانية قبل إنشاء تذكرة جديدة.`, 
                                flags: [64] 
                            });
                            break;
                        }
                    }
                    
                    ticketBot.cooldowns.set(inquiryCooldownKey, inquiryNow);
                    setTimeout(() => ticketBot.cooldowns.delete(inquiryCooldownKey), inquiryCooldownAmount);
                    
                    // إنشاء روم تذكرة جديد
                    const inquiryGuildAdminRoles = ticketBot.adminRoles.get(interaction.guild.id) || [];
                    const inquiryPermissionOverwrites = [
                        {
                            id: interaction.guild.id,
                            deny: ['ViewChannel'],
                        },
                        {
                            id: interaction.user.id,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                        },
                    ];
                    
                    // إضافة رتب المشرفين
                    inquiryGuildAdminRoles.forEach(roleId => {
                        inquiryPermissionOverwrites.push({
                            id: roleId,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'],
                        });
                    });
                    
                    const inquiryChannel = await interaction.guild.channels.create({
                        name: `استفسار-${interaction.user.username}`,
                        type: 0, // text channel
                        parent: null, // يمكن تحديد category إذا أردت
                        permissionOverwrites: inquiryPermissionOverwrites,
                    });
                    
                    const inquiryEmbed = createTicketEmbed(
                        'استفسار',
                        'هذه التذكرة مخصصة للإجابة على استفساراتكم',
                        interaction.user
                    );
                    
                    // إرسال رسالة في الروم الجديد مع أزرار الإدارة
                    const inquiryManageButtons = createTicketManageButtons();
                    const inquiryAttachment = new AttachmentBuilder('images/qren-store-logo.png', { name: 'qren-store-logo.png' });
                    
                    await retryWithDelay(async () => {
                        await inquiryChannel.send({ embeds: [inquiryEmbed], components: [inquiryManageButtons], files: [inquiryAttachment] });
                    });
                    
                    await interaction.reply({ 
                        content: `تم إنشاء تذكرة استفسار في ${inquiryChannel}`, 
                        flags: [64] 
                    });
                    break;

                case 'ticket_problem':
                    // فحص cooldown لمنع إنشاء تذاكر متعددة
                    const problemUserId = interaction.user.id;
                    const problemCooldownKey = `${problemUserId}-ticket`;
                    const problemNow = Date.now();
                    const problemCooldownAmount = 30000; // 30 ثانية للحماية من الحظر
                    
                    if (ticketBot.cooldowns.has(problemCooldownKey)) {
                        const problemExpirationTime = ticketBot.cooldowns.get(problemCooldownKey) + problemCooldownAmount;
                        
                        if (problemNow < problemExpirationTime) {
                            const problemTimeLeft = (problemExpirationTime - problemNow) / 1000;
                            await interaction.reply({ 
                                content: `يجب الانتظار ${problemTimeLeft.toFixed(1)} ثانية قبل إنشاء تذكرة جديدة.`, 
                                flags: [64] 
                            });
                            break;
                        }
                    }
                    
                    ticketBot.cooldowns.set(problemCooldownKey, problemNow);
                    setTimeout(() => ticketBot.cooldowns.delete(problemCooldownKey), problemCooldownAmount);
                    
                    // إنشاء روم تذكرة جديد
                    const problemGuildAdminRoles = ticketBot.adminRoles.get(interaction.guild.id) || [];
                    const problemPermissionOverwrites = [
                        {
                            id: interaction.guild.id,
                            deny: ['ViewChannel'],
                        },
                        {
                            id: interaction.user.id,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                        },
                    ];
                    
                    // إضافة رتب المشرفين
                    problemGuildAdminRoles.forEach(roleId => {
                        problemPermissionOverwrites.push({
                            id: roleId,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'],
                        });
                    });
                    
                    const problemChannel = await interaction.guild.channels.create({
                        name: `حل-مشكلة-${interaction.user.username}`,
                        type: 0, // text channel
                        parent: null, // يمكن تحديد category إذا أردت
                        permissionOverwrites: problemPermissionOverwrites,
                    });
                    
                    const problemEmbed = createTicketEmbed(
                        'لحل مشكلة',
                        'هذه التذكرة مخصصة في حال كان لديك مشكلة',
                        interaction.user
                    );
                    
                    // إرسال رسالة في الروم الجديد مع أزرار الإدارة
                    const problemManageButtons = createTicketManageButtons();
                    const problemAttachment = new AttachmentBuilder('images/qren-store-logo.png', { name: 'qren-store-logo.png' });
                    
                    await retryWithDelay(async () => {
                        await problemChannel.send({ embeds: [problemEmbed], components: [problemManageButtons], files: [problemAttachment] });
                    });
                    
                    await interaction.reply({ 
                        content: `تم إنشاء تذكرة حل مشكلة في ${problemChannel}`, 
                        flags: [64] 
                    });
                    break;

                case 'claim_ticket':
                    // التحقق من أن المستخدم مشرف تذاكر
                    const claimGuildId = interaction.guild.id;
                    const claimAdminRoles = ticketBot.adminRoles.get(claimGuildId) || [];
                    const claimUserRoles = interaction.member.roles.cache.map(role => role.id);
                    const claimIsAdmin = claimAdminRoles.some(roleId => claimUserRoles.includes(roleId)) || interaction.member.permissions.has('ManageChannels');
                    
                    if (!claimIsAdmin) {
                        await interaction.reply({ content: 'لا يمكنك استلام التذاكر. هذه الميزة مخصصة للمشرفين فقط.', flags: [64] });
                        break;
                    }
                    
                    const claimEmbed = new EmbedBuilder()
                        .setTitle('👤 تم استلام التذكرة')
                        .setDescription(`تم استلام هذه التذكرة من قبل ${interaction.user}\nسيتم التعامل معها في أقرب وقت.`)
                        .setColor(0x3498db)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [claimEmbed] });
                    break;
                    
                case 'close_ticket':
                    // التحقق من أن المستخدم مشرف تذاكر
                    const closeGuildId = interaction.guild.id;
                    const closeAdminRoles = ticketBot.adminRoles.get(closeGuildId) || [];
                    const closeUserRoles = interaction.member.roles.cache.map(role => role.id);
                    const closeIsAdmin = closeAdminRoles.some(roleId => closeUserRoles.includes(roleId)) || interaction.member.permissions.has('ManageChannels');
                    
                    if (!closeIsAdmin) {
                        await interaction.reply({ content: 'لا يمكنك قفل التذكرة. هذه الميزة مخصصة للمشرفين فقط.', flags: [64] });
                        break;
                    }
                    
                    const closeEmbed = new EmbedBuilder()
                        .setTitle('🔒 جاري قفل التذكرة')
                        .setDescription('سيتم قفل هذه التذكرة في غضون 10 ثوان...')
                        .setColor(0xe74c3c)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [closeEmbed] });
                    
                    // إرسال السجل قبل الحذف
                    try {
                        await sendTicketLog(interaction.channel, interaction.user, 'قفل التذكرة');
                    } catch (logError) {
                        console.error('خطأ في إرسال سجل التذكرة:', logError);
                    }
                    
                    // حذف القناة بعد 10 ثوان
                    setTimeout(async () => {
                        try {
                            await interaction.channel.delete();
                        } catch (error) {
                            console.error('خطأ في حذف قناة التذكرة:', error);
                        }
                    }, 10000);
                    break;
            }
        } catch (error) {
            console.error('خطأ في معالجة الأزرار:', error.message || error);
            // عدم الرد على الأخطاء لتجنب interaction acknowledged errors
        }
    }
});

// بوت التقييمات
reviewBot.once('ready', async () => {
    console.log(`بوت التقييمات جاهز! مسجل باسم ${reviewBot.user.tag}`);
    await registerReviewCommands();
});

// معالجة slash commands للتقييمات
reviewBot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // فحص rate limiting للحماية من الحظر
    if (checkRateLimit(reviewBot, interaction.user.id, 'review', 5000)) {
        try {
            await interaction.reply({ 
                content: 'يرجى الانتظار قليلاً قبل إرسال تقييم آخر.', 
                ephemeral: true 
            });
        } catch (error) {
            console.log('تم تجاهل تقييم مكرر لتجنب الحظر');
        }
        return;
    }

    const { commandName } = interaction;

    try {
        if (commandName === 'تقييم' || commandName === 'review') {
            const rating = interaction.options.getInteger('rating');
            
            // الحصول على إحصائيات التقييم للمستخدم
            const userId = interaction.user.id;
            let userStats = reviewBot.reviewStats.get(userId) || { count: 0, lastReviewId: 2000 };
            userStats.count++;
            userStats.lastReviewId++;
            reviewBot.reviewStats.set(userId, userStats);
            
            // إنشاء embed التقييم
            const reviewEmbed = createReviewEmbed(rating, interaction.user, userStats.lastReviewId, userStats.count);
            
            // إرسال التقييم
            await interaction.reply({ embeds: [reviewEmbed] });
        } else if (commandName === 'اختيار_روم_تقييم' || commandName === 'set_review_room') {
            const channel = interaction.options.getChannel('channel');
            const guildId = interaction.guild.id;
            
            // حفظ الروم المخصص للتقييم
            reviewBot.reviewChannels.set(guildId, channel.id);
            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ تم تحديد روم التقييم')
                .setDescription(`تم تحديد ${channel} كروم للتقييمات.\nالآن أي رسالة ترسل في هذا الروم ستتحول تلقائياً إلى تقييم.`)
                .setColor(0x00AE86);
            
            await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        }
    } catch (error) {
        console.error('خطأ في بوت التقييمات:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: 'حدث خطأ أثناء إرسال التقييم', ephemeral: true });
        }
    }
});

// بوت التقييم يعمل في الروم المحددة أو القنوات المسماة للتقييم
reviewBot.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // فحص rate limiting للرسائل النصية
    if (checkRateLimit(reviewBot, message.author.id, 'message_review', 10000)) {
        return; // تجاهل الرسالة بصمت لتجنب الحظر
    }
    
    const guildId = message.guild?.id;
    const channelId = message.channel.id;
    
    // التحقق إذا كان هذا الروم محدد للتقييمات
    const selectedReviewChannel = reviewBot.reviewChannels.get(guildId);
    const isSelectedChannel = selectedReviewChannel === channelId;
    
    // أو التحقق إذا كانت القناة تحتوي على كلمة "تقييم" أو "review" في الاسم
    const channelName = message.channel.name ? message.channel.name.toLowerCase() : '';
    const isReviewChannel = channelName.includes('تقييم') || 
                           channelName.includes('review') || 
                           channelName.includes('rating') ||
                           channelName.includes('feedback');
    
    // أو إذا كانت الرسالة تحتوي على رقم من 1-5 فقط
    const isRatingMessage = /^[1-5]$/.test(message.content.trim());
    
    if (isSelectedChannel || isReviewChannel || isRatingMessage) {
        try {
            // حذف الرسالة الأصلية
            await message.delete().catch(() => {});
            
            // استخراج التقييم
            let rating;
            const ratingMatch = message.content.match(/[1-5]/);
            if (ratingMatch) {
                rating = parseInt(ratingMatch[0]);
            } else {
                // إذا لم يكن هناك رقم محدد، أعطي تقييم حسب طول النص
                const textLength = message.content.length;
                if (textLength > 50) rating = 5;
                else if (textLength > 30) rating = 4;
                else if (textLength > 15) rating = 3;
                else if (textLength > 5) rating = 2;
                else rating = 1;
            }
            
            // الحصول على إحصائيات التقييم للمستخدم
            const userId = message.author.id;
            let userStats = reviewBot.reviewStats.get(userId) || { count: 0, lastReviewId: 2000 };
            userStats.count++;
            userStats.lastReviewId++;
            reviewBot.reviewStats.set(userId, userStats);
            
            // إنشاء embed التقييم مع النص الأصلي
            const reviewEmbed = createReviewEmbedWithText(rating, message.author, userStats.lastReviewId, userStats.count, message.content);
            
            // إرسال التقييم
            await message.channel.send({ embeds: [reviewEmbed] });
            
        } catch (error) {
            console.error('خطأ في بوت التقييمات:', error);
        }
    }
});

module.exports = {
    ticketBot,
    reviewBot,
    createTicketMainEmbed,
    createTicketOptionsEmbed,
    createTicketEmbed,
    createReviewEmbed,
    registerTicketCommands,
    registerReviewCommands
};
