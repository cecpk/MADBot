// Not the best fix in the world, but gets rid of the
// `deprecated Automatic enabling of cancellation of promises is deprecated.` message
process.env["NTBA_FIX_319"] = 1;

var     fs          = require('fs'),
        request     = require('request'),
        config      = JSON.parse(fs.readFileSync('./config.ini', 'utf8')),
        Discord = false,
        Telegram = false
;

var appexit = (err = null) => {
    if (err){
        console.log("\x1b[31m%s\x1b[0m", err);
    }
    if (Discord){
        Discord.destroy((err) => {
            console.log(err);
        });
    }
    process.exit();
};

// set up services to send to
if (typeof config.discordtoken !== 'undefined' && config.discordtoken !== ''){
    if (typeof config.discordChannel === 'undefined' || config.discordChannel === ''){
        appexit('You have to have the "discordChannel" section filled out in your config!');
    }
    // Login done in Discord block later
    Discord = new (require('discord.js')).Client();

}

if (typeof config.telegramtoken !== 'undefined' && config.telegramtoken !== ''){
    if (typeof config.telegramChat === 'undefined' || config.telegramChat === ''){
        appexit('You have to have the "telegramChat" section filled out in your config!');
    }
    // Login done here for Telegram
    Telegram = new (require('node-telegram-bot-api'))(config.telegramtoken, { polling: true });
}

if (!Discord && !Telegram){
    appexit('You have to have at least one service (Discord or Telegram) set up!');
}

// Check required config options
let required = ['screenshotsLocation'];
for(let i in required){
    if (typeof config[required[i]] === 'undefined' || config[required[i]] === ''){
        appexit('Config not filled out! You have to have the "channel", and ' +
            '"screenshotsLocation" sections filled out!');
    }
}

// Set up download function
var download = (url, finishedCallback = false) => {
    console.log('Downloading file: '+url);
    request.get(url)
        .pipe(fs.createWriteStream(config.screenshotsLocation + '/' +
            'raidscreen_'+Date.now()+'_9999_9999_99.jpg'))
        .on('close', function(){
            console.log('Finished adding file');
            if (finishedCallback){
                finishedCallback();
            }
        })
        .on('error', function (err) {
            console.log(err);
        });
};

// Set up Discord requirements
if (Discord) {
    var discordReady = () => {
        console.log('Ready to go MAD');
    };

    var discordMessage = message => {
        //don't respond if it's a bot
        if (message.author.bot) return;
        //don't respond if not on a text chat
        if (message.channel.type !== 'text') return;
        if (config.discordChannel !== 'all' && message.channel.id !== config.discordChannel) return;
        if (message.attachments.size > 0){
            message.attachments.forEach(function(attachment){
                download(attachment.url, () => {
                    if (typeof config.confirmationMessage !== 'undefined' && conf.confirmationMessage) {
                        message.channel.send('File successfully uploaded').then(m => {
                            m.delete(5000);
                        });
                    }
                });
            });
        }
    };

    Discord.on('ready', discordReady);
    Discord.on('message', discordMessage);
    Discord.login(config.discordtoken);
    Discord.on('disconnect', (event) => {
        console.log(`Disconnected with code ${ event.code }`);
        if(event.code !== 1006)
            appexit();
        else
            Discord.destroy().then(() => Discord.login(config.discordtoken));
    });
}

// Set up Telegram requirements
if (Telegram){
    var telegramErrorMessage = (errorObj) => {
        // error.response is not available if code is EFATAL
        if (errorObj.code === 'EFATAL'){
            return 'Fatal error';
        }
        // error.response.body is a string if code is EPARSE
        if (errorObj.code === 'EPARSE'){
             return errorObj.response.body;
        }
        // error.response.body is an object if code is ETELEGRAM
        if (errorObj.code === 'ETELEGRAM'){
            return `(Code ${ errorObj.response.body.error_code }) ${ errorObj.response.body.description }`;
        }
    };

    var telegramError = (type, error) => {
        if (typeof error.message !== 'undefined' && typeof error.stack !== 'undefined'){
            appexit(`Other error: ${ error.message }\n${ error.stack }`);
        }
        console.log(`${ type } error - ${ error.code }: ${ telegramErrorMessage(error) }`);
    };

    var getPhotoId = (arrayItems) => {
        let biggestPhoto = false;
        let biggestPhotoSize = false;
        for(let i = arrayItems.length - 1; i >= 0; i--){
            if (arrayItems[i].file_size > biggestPhotoSize){
                biggestPhoto = arrayItems[i];
                biggestPhotoSize = arrayItems[i].file_size;
            }
        }
        if (biggestPhoto) return biggestPhoto.file_id;
        return false;
    };

    var telegramPost = (msg) => {
        if (config.telegramChat !== 'all' && msg.chat.id !== config.telegramChat) return;
        let link = false;
        // The "Gallery" option comes in this
        if (typeof msg.photo !== 'undefined' && msg.photo.length > 0){
            link = getPhotoId(msg.photo);
        }
        // The "File" option comes in this
        if (typeof msg.document !== 'undefined' &&
        (msg.document.file_name.endsWith('.png') || msg.document.file_name.endsWith('.jpg'))){
            link = msg.document.file_id;
        }

        // Couldn't contain a valid image
        if (!link) return false;

        Telegram.getFileLink(link).then((url) => {
            download(url, () => {
                if (typeof config.confirmationMessage !== 'undefined' && config.confirmationMessage) {
                    Telegram.sendMessage(msg.chat.id, 'Photo successfully uploaded!');
                }
            });
        });
    };

    Telegram.on('photo', (msg) => telegramPost(msg));
    Telegram.on('channel_post', (msg) => telegramPost(msg));
    Telegram.on('polling_error', (error) => { telegramError('Polling', error); });
    Telegram.on('webhook_error', (error) => { telegramError('Webhook', error); });

}

//do some cleanup on ctrl + c
process.on('SIGINT', () => {
    appexit();
});