const { ticketBot, reviewBot } = require('./client');
const tokens = require('./tokens');
const http = require('http');

// إنشاء HTTP server بسيط لـ Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'البوتات تعمل بنجاح',
        bots: {
            ticket_bot: ticketBot.user ? ticketBot.user.tag : 'غير متصل',
            review_bot: reviewBot.user ? reviewBot.user.tag : 'غير متصل'
        },
        uptime: process.uptime()
    }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP Server يعمل على البورت ${PORT}`);
});

// دالة لبدء تشغيل البوتات
async function startBots() {
    try {
        console.log('بدء تشغيل البوتات...');
        
        // التحقق من وجود التوكنات
        if (!tokens.REMINDER_BOT_TOKEN) {
            console.warn('تحذير: لم يتم تعيين REMINDER_BOT_TOKEN');
        }
        
        if (!tokens.REVIEW_BOT_TOKEN) {
            console.warn('تحذير: لم يتم تعيين REVIEW_BOT_TOKEN');
        }
        
        // تشغيل بوت التذاكر
        if (tokens.REMINDER_BOT_TOKEN) {
            await ticketBot.login(tokens.REMINDER_BOT_TOKEN);
            console.log('✅ تم تشغيل بوت التذاكر بنجاح');
        } else {
            console.log('⚠️ تم تخطي بوت التذاكر - لا يوجد توكن');
        }
        
        // تشغيل بوت التقييمات
        if (tokens.REVIEW_BOT_TOKEN) {
            await reviewBot.login(tokens.REVIEW_BOT_TOKEN);
            console.log('✅ تم تشغيل بوت التقييمات بنجاح');
        } else {
            console.log('⚠️ تم تخطي بوت التقييمات - لا يوجد توكن');
        }
        
        console.log('\n🚀 تم تشغيل جميع البوتات المتاحة!');
        console.log('\n🎫 أوامر بوت التذاكر (Slash Commands):');
        console.log('   /تذكرة - فتح نظام التذاكر مع الأزرار');
        console.log('   /ticket - Open ticket system (English)');
        console.log('   /help - عرض الأوامر');
        console.log('   • الأزرار: للشراء | للاستفسار | لحل مشكلة');
        console.log('\n⭐ بوت التقييمات (Slash Commands + Text):');
        console.log('   /تقييم [rating] - إرسال تقييم بالنجوم');
        console.log('   /review [rating] - Send star rating (English)');
        console.log('   أو اكتب رقم من 1-5 في أي رسالة (الطريقة القديمة)');
        
    } catch (error) {
        console.error('خطأ في تشغيل البوتات:', error);
        process.exit(1);
    }
}

// معالجة الأخطاء غير المتوقعة
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// بدء تشغيل البوتات
startBots();
