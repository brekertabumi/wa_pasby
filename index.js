const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const http = require('http');
const https = require('https');
const qrcode = require('qrcode');

const {phoneNumberFormatter} = require('./helpers/formatter.js');
const {tgl_indo} = require('./helpers/tanggal_indo.js');
const mime = require('mime-types');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

var db = require("./helpers/db_config.js");

(async() => {
	app.get('/',(req, res) => {
		res.sendFile('index.html', {root: __dirname});
	});
	const savedSession = await db.readSession();

	const client = new Client({
	  restartOnAuthFail: true,
	  puppeteer: {
		headless: true,
		args: [
		  '--no-sandbox',
		  '--disable-setuid-sandbox',
		  '--disable-dev-shm-usage',
		  '--disable-accelerated-2d-canvas',
		  '--no-first-run',
		  '--no-zygote',
		  '--single-process', 
		  '--disable-gpu',
		  '--disable-web-security'
		],
	  },
	  session: savedSession
	});
	
	client.initialize();

	//socket.io 
	io.on('connection', async function(socket) {
		try {
			socket.emit('message','connecting...');		
			client.on('qr', (qr) => {
				console.log('QR RECEIVED', qr);
				qrcode.toDataURL(qr, (err, url) => {
					 socket.emit('qr', url);
					 socket.emit('message', 'QR code diterima,silahkan di scan!');
				});
			});
			
			client.on('ready', () => {
				 socket.emit('ready', "Whastapp is ready!");
				 socket.emit('message', "Whastapp is ready!");
			});

			client.on('authenticated', (session) => {
				socket.emit('authenticated', "Whastapp is authenticated!");
				socket.emit('message', "Whastapp is authenticated!");
				socket.emit('session', session);
				console.log('AUTHENTICATED', session);
				//save ke DB
				db.saveSession(session);
			});

			client.on('auth_failure', function(session) {
				socket.emit('message', 'Autentifikasi ke server Whatsapp ada kesalahan, restart ulang...');
			});

			client.on('disconnected', (reason) => {
				socket.emit('message', 'Whatsapp is disconnected!');
				//remove Session
				db.removeSession();
				
				client.destroy();
				client.initialize();
			});
		}catch(err) {
			throw err;
		}
	});
	//cek nomor apakah terdaftar diWA 
	const checkRegisteredNumber = async function(number){
		const isRegistered = await client.isRegisteredUser(number);
		return isRegistered;
	} 

	// Send message
	app.post('/send-message', [
	  body('number').notEmpty(),
	  body('message').notEmpty(),
	], async (req, res) => {
	  const errors = validationResult(req).formatWith(({
		msg
	  }) => {
		return msg;
	  });

	  if (!errors.isEmpty()) {
		return res.status(422).json({
		  status: false,
		  message: errors.mapped()
		});
	  }

	  const number = phoneNumberFormatter(req.body.number);
	  const message = req.body.message;

	  const isRegisteredNumber = await checkRegisteredNumber(number);

	  if (!isRegisteredNumber) {
		return res.status(422).json({
		  status: false,
		  message: 'The number is not registered'
		});
	  }

	  client.sendMessage(number, message).then(response => {
		res.status(200).json({
		  status: true,
		  response: response
		});
	  }).catch(err => {
		res.status(500).json({
		  status: false,
		  response: err
		});
	  });
	});

	server.listen(port, function() {
	  console.log('App running on *: ' + port);
	});
})(); 
