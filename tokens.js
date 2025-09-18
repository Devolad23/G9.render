// ملف الـ tokens للبوتات
module.exports = {
    // توكن بوت التذكيرات
    REMINDER_BOT_TOKEN: process.env.REMINDER_BOT_TOKEN || '',
    
    // توكن بوت التقييمات  
    REVIEW_BOT_TOKEN: process.env.REVIEW_BOT_TOKEN || '',
    
    // معرف القناة للتقييمات (اختياري)
    REVIEW_CHANNEL_ID: process.env.REVIEW_CHANNEL_ID || '',
    
    // بادئة الأوامر
    PREFIX: '!'
};
