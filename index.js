var CronJob = require('cron').CronJob; //https://www.npmjs.com/package/cron
var Express = require('express');
var BodyParser = require('body-parser');
var RestClient = require('node-rest-client').Client //https://www.npmjs.com/package/node-rest-client
var db = require("./db.js");

// add timestamps in front of log messages
require('console-stamp')(console, 'mm/dd/yyyy HH:MM:ss.l');

// define express app
var app = Express().use(BodyParser.json());
var rest = new RestClient();

// some constants
const twitchClient = process.env.TWITCH_CLIENT_ID;
const twitchSecret = process.env.TWITCH_SECRET;
const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
const replUrl = process.env.REPL_URL;
const hubSecret = process.env.HUB_SECRET;
const passcode = process.env.PASSCODE;
const authUrl = 'https://id.twitch.tv/oauth2';
const apiUrl = 'https://api.twitch.tv/helix';
var api_token;

// register remote methods for the rest client
// to make life easier later in the code
rest.registerMethod("TwitchAuthenticate", `${authUrl}/token`, "POST");
rest.registerMethod("TwitchValidateToken", `${authUrl}/validate`, "GET");
rest.registerMethod("TwitchRevokeToken", `${authUrl}/revoke`, "POST");
rest.registerMethod("TwitchGetWebhookSub", `${apiUrl}/webhooks/subscriptions`, "GET");
rest.registerMethod("TwitchPostWebhookSub", `${apiUrl}/webhooks/hub`, "POST");
rest.registerMethod("TwitchGetUser", apiUrl + '/users?${users}', "GET"); // Yeah this one's weird.
rest.registerMethod("TwitchGames", `${apiUrl}/games`, "GET");
rest.registerMethod("DiscordSendPayload", discordWebhook, "POST");

// Get a list of streamers
function GetStreamers() {
  return new Promise(function(resolve, reject) {
    let result = [];
    const sql = `SELECT streamer FROM streamers`;
    db.each(sql, (err, row) => {
      if(err) { reject(err) }
      result.push(row.streamer)
    }, () => {
      resolve(result)
    })
  });
}

// Remove streamer from the DB
function RemoveStreamerFromDb(username) {
  return new Promise(function(resolve, reject) {
    var params = [username.toUpperCase()];
    const sql = `DELETE FROM streamers WHERE streamer = ?`;
    db.run(sql, params, (err, row) => {
      if(err) { reject(err) }
      resolve(true);
    });
  });
}

// Add a streamer to the DB
function AddStreamerToDb(username) {
  console.log(`Adding ${username} to DB`);
  return new Promise(function(resolve, reject) {
    // Check if they already exist
    const check = `SELECT count(*) AS streamcount FROM streamers WHERE streamer = ?`;

    var params = [username.toUpperCase()];

    db.get(check, params, (err, row) => {
      if(err) { reject(err) }

      // if length = 0 then insert
      if (row.streamcount == 0) {
        const sql = `INSERT INTO streamers (streamer) VALUES (?)`;
        db.run(sql, params, (err, row) => {
          if(err) { reject(err) }
          resolve(true);
        });
      }
      resolve(false);
    });
  });
}

// Authenticate with Twitch
async function GetTwitchToken() {
  var currentToken = api_token;
  var isCurrentTokenValid = await ValidateTwitchToken(currentToken);
  
  return new Promise(function(resolve, reject) {
    if(isCurrentTokenValid) {
      resolve(currentToken);
    } else {
      var args = {
        parameters:{
          "client_id":twitchClient, 
          "client_secret":twitchSecret,
          "grant_type":"client_credentials"
        }
      };
      rest.methods.TwitchAuthenticate(args, function (data, response) {
        console.log(`Got Token ${data.access_token}`);
        api_token = data.access_token;
        if(IsStatusOkay(response.statusCode)) resolve(data.access_token);
        reject(Error(data.message));
      });
    }
  });
}

// Validate Twitch token
async function ValidateTwitchToken (token) {
  return new Promise(function(resolve, reject) {
    var args = {
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Client-ID": twitchClient
      }
    };
    rest.methods.TwitchValidateToken(args, function (data, response) {
      if(IsStatusOkay(response.statusCode)) resolve(true);
      if(response.statusCode == 401) resolve(false);
      reject(Error(data.message));
    });
  });
}

// Revoke Twitch token
function RevokeTwitchToken (token) {
  return new Promise(function(resolve, reject) {
    var args = {
      parameters:{
        "client_id":twitchClient,
        "token":token
      },
    };
    rest.methods.TwitchRevokeToken(args, function (data, response) {
      // parsed response body as js object
      // console.log(data);

      if(IsStatusOkay(response.statusCode)) resolve(true);
      reject(Error(data.message));
    });
  });
}

// Get Twitch webhook subscriptions
function GetTwitchWebhookSubs (token) {
  return new Promise(function(resolve, reject) {
    var args = {
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Client-ID": twitchClient
      }
    };
    rest.methods.TwitchGetWebhookSub(args, function (data, response) {
      if(IsStatusOkay(response.statusCode)) {
        var subs = GetUserIdFromSubscriptionTopics(data.data);

        var cursor = (data.pagination.hasOwnProperty("cursor")) ? data.pagination.cursor : false;

        // Loop in case we get a paginated result
        while(cursor !== false) {
          args.parameters = {"after": cursor};
          rest.methods.TwitchGetWebhookSub(args, function (data, response) {
            if(IsStatusOkay(response.statusCode)) {
              var thisPage = GetUserIdFromSubscriptionTopics(data.data);
              subs = subs.concat(thisPage);

              // Set the next cursor
              cursor = (data.pagination.hasOwnProperty("cursor")) ? data.pagination.cursor : false;
            } else {
              cursor = false;
            }
          });
        }
        resolve(subs);
      }
      reject(Error(data.message));
    });
  });
}

// Extract user Ids from a subcription topic url
function GetUserIdFromSubscriptionTopics(subs) {
  var userIds = [];
  subs.forEach(subModel => {
    var topic = subModel.topic;
    var userId = topic.replace('https://api.twitch.tv/helix/streams?user_id=', '');
    userIds.push(userId);
  });
  return userIds;
}

// Get Twitch user ID(s) from an array of
// username(s)
//TODO: needs to handle pagination
function GetUserIds(usernames, token) {
  return new Promise(function(resolve, reject) {
    if(!Array.isArray(usernames)) reject(Error("Array required"));

    // Need to handle the parameters differently here
    // because Twitch only supports the following syntax
    // "?login=username1&login=username2" etc... and JS
    // doesn't allow an object to have multiple properties
    // with identical keys.
    var usernameList = "login=" + usernames.join("&login=");

    var args = {
      path: {"users": usernameList},
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Client-ID": twitchClient,
        "Content-Type": "application/json"
      }
    };
    rest.methods.TwitchGetUser(args, function (data, response) {
      if(IsStatusOkay(response.statusCode)) {
        var streamerIds = []
        data.data.forEach(streamer => {
          streamerIds.push(streamer.id);
        });
        resolve(streamerIds);
      }
      reject(Error(data));
    });
  });
}

// Get Twitch Game
async function GetTwitchGameById (gameId, token) {
  return new Promise(function(resolve, reject) {
    var args = {
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Client-ID": twitchClient
      },
      parameters: {
        id: gameId
      }
    };
    rest.methods.TwitchGames(args, function (data, response) {
      if(IsStatusOkay(response.statusCode)) {
        var gameData = data.data.shift();
        console.log(`${gameId} = ${gameData.name}`);
        resolve(gameData.name);
      } 
      reject(Error(data.message));
    });
  });
}

// Create Twitch webhook subscription given
// a user ID
function SubscribeToTwitch (userId, token, unsub = false) {
  return new Promise(function(resolve, reject) {
    var mode = (unsub) ? 'unsubscribe' : 'subscribe';

    console.log(`${mode} to ${userId}`);

    var args = {
      headers: { 
        Authorization: `Bearer ${token}`,
        "Client-ID": twitchClient,
        "Content-Type": "application/json;charset=utf-8"
      },
      data: {
        "hub.callback": `${replUrl}/webhook`,
        "hub.mode": mode,
        "hub.topic" :`https://api.twitch.tv/helix/streams?user_id=${userId}`,
        "hub.lease_seconds": "864000",
        "hub.secret": hubSecret
      }
    };
    rest.methods.TwitchPostWebhookSub(args, function (data, response) {
      if(IsStatusOkay(response.statusCode)) resolve(true);
      reject(Error(response.statusCode + '\n' +data.message));
    });
  });
}

// Check Twitch webhook subscriptions and 
// resubscribe to the missing ones
async function CheckForWebhookSubscription(usernames, token) {
  var userIds = await GetUserIds(usernames, token);
  var webhookSubs = await GetTwitchWebhookSubs(token);

  // If we're not subbed to the webhook
  // for a user, subscribe to it.
  userIds.forEach(userId => {
    if(!SubExists(userId, webhookSubs)) {
      SubscribeToTwitch(userId, token).catch(error => {console.error(error)});
      console.log(`Subbed to ${userId}.`);
    }
  });
}

// Really just checks if value is in array
function SubExists(userId, subs) {
  return subs.includes(userId);
}

// Cron job to refresh webhooks
async function RefreshWebhooks() {
    var streamers = await GetStreamers();
    console.log(streamers);

    var bearerToken = await GetTwitchToken();

    await CheckForWebhookSubscription(streamers, bearerToken);

    //await RevokeTwitchToken(bearerToken);
    //console.log(`Token ${bearerToken} revoked.`);
}

// Remove a streamer from the webhook list
async function RemoveStreamer(username) {
  var streamers = await GetStreamers();

  // If they're not on our list, do nothing.
  if(!streamers.includes(username)) return;

  var bearerToken = await GetTwitchToken();

  var userIds = await GetUserIds([username], bearerToken);
  console.log(`UserId: ${userIds}`);

  await SubscribeToTwitch(userIds[0], bearerToken, true)
    .catch(error => {console.error(error)});

  //await RevokeTwitchToken(bearerToken);
  //console.log(`Token ${bearerToken} revoked.`);

  await RemoveStreamerFromDb(username);
  console.log(`Removed ${username} removed from DB.`);
}

// Send a payload to discord webhook
function SendToDiscord (msg) {
  return new Promise(function(resolve, reject) {
    console.log(`Telling discord: ${msg}`);

    var args = {
      headers: {
        "Content-Type": "application/json"
      },
      data: {
        "content": msg
      }
    };
    rest.methods.DiscordSendPayload(args, function (data, response) {
      if(IsStatusOkay(response.statusCode)) resolve(true);
      reject(Error(response.statusCode + '\n' +data.message));
    });
  });
}

// HTTP Status Code Check. Quick & Dirty.
function IsStatusOkay(statusCode) {
  if(statusCode >= 200 && statusCode < 300) return true;
  return false;
}

// Webhook handler
async function TwitchWebhook(payload) {
  console.log(`${payload.user_name} is live with game id ${payload.game_id}`);

  // game_id CAN be blank.
  if(payload.game_id != "") {
    var token = await GetTwitchToken();
    var game = await GetTwitchGameById (payload.game_id, token);
    var msg = `${payload.user_name} is streaming ${game}. <https://twitch.tv/${payload.user_name}>`;
  } else {
    var msg = `${payload.user_name} is live. <https://twitch.tv/${payload.user_name}>`;
  }
  
  SendToDiscord (msg);
}

// Accept Challenge
app.get('/webhook', (req, res) => {
  console.log("Got a challenge");

  // Parse the query params
  let mode = req.query['hub.mode'];
  let challenge = req.query['hub.challenge'];
    
  // Checks the mode and token sent is correct
  if (mode === 'subscribe' || mode === 'unsubscribe') {
    
    // Responds with the challenge token
    // from the request
    console.log('Challenge verified');
    res.status(200).send(challenge);
  
  } else {
    // Responds with '403 Forbidden' if 
    // verify tokens do not match
    res.sendStatus(403);    
  }
});

// Root page (blank page)
app.get('/', (req, res) => {
  res.status(200).send("");
});

// Adding a streamer
app.get('/a/:password/:username', async (req, res) => {
  var username = req.params.username;
  var password = req.params.password;

  // Verify this is a valid request
  if(password == passcode) {
    console.log(`Got a request to add ${username}`);

    // Add the streamer to the db
    await AddStreamerToDb(username);

    // Refresh the webhook so we subscribe to updates
    RefreshWebhooks();

    res.status(200).send("Done.");
  } else {
    res.status(401).send("Not Authorized.");
  }
});

// Removing a streamer
app.get('/d/:password/:username', async (req, res) => {
  var username = req.params.username;
  var password = req.params.password;

  // Verify this is a valid request
  if(password == passcode) {
    console.log(`Got a request to remove ${username}`);

    // Remove the streamer from the DB
    // And remove their webhook subscription
    await RemoveStreamer(username);

    res.status(200).send("Done.");
  } else {
    res.status(401).send("Not Authorized.");
  }
});

// Handle webhook notifications
app.post('/webhook', (req, res) => {
  var body = req.body.data;
  console.log("Got a webhook with a body length of " + body.length);
  //console.log(body);

  // We still get a webhook when a streamer
  // ends their stream (it's an empty array)
  // but we don't want to do process that
  if(body.length > 0 && body[0].type == 'live') {
    TwitchWebhook(body[0]);
  }
    
  res.status(200).send("OK");
});


// Refresh the webook subscriptions every day at midnight
// Twitch webhooks expire every 10 days so this is a bit
// overkill, but once a day isn't too bad.
var job = new CronJob('00 00 00 * * *', function() {
  console.log('Cron job running');
  RefreshWebhooks();
}, null, true, 'America/Edmonton');
job.start();

// Run express web server
var server = app.listen(8081, function() {
  console.log("App listening.");
});

// Do first refresh when the app starts.
// So we're ready to go right away.
RefreshWebhooks();