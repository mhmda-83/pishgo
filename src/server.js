/* eslint-disable no-underscore-dangle */
const mongoose = require('mongoose');
const express = require('express');
const _ = require('lodash');

const app = express();

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
	path: path.join(__dirname, '..', '.env'),
});

const createBot = require('./bot');
const Statistics = require('./models/statistics');

const { getConfigs } = require('./configs');

const config = getConfigs();
const bot = createBot(config);

app.use(bot.webhookCallback(`/bot${config.webhookRouteToken}`));

// eslint-disable-next-line consistent-return
app.get(`/${config.statisticsRouteToken}/statistics`, async (req, res) => {
	if (req.query.token !== config.token) return res.sendStatus(403);

	const chatIds = (
		await Statistics.aggregate([
			{
				$group: {
					_id: '$chat.id',
				},
			},
		])
	)
		.filter((chat) => chat._id != null)
		.map((chat) => chat._id);

	const userIds = (
		await Statistics.aggregate([
			{
				$group: { _id: '$userId' },
			},
		])
	)
		.filter((user) => user._id != null)
		.map((user) => user._id);

	const allOfChatIds = Array.from(new Set([...chatIds, ...userIds]));

	let allOfChats = [];

	for (let i = 0; i < allOfChatIds.length; i += 1) {
		allOfChats.push(bot.telegram.getChat(allOfChatIds[i]));
	}

	allOfChats = await Promise.allSettled(allOfChats);

	const wantedFields = [
		'id',
		'title',
		'first_name',
		'last_name',
		'bio',
		'description',
		'username',
		'type',
	];

	allOfChats = allOfChats.filter(
		(promiseResult) => promiseResult.status === 'fulfilled',
	);

	allOfChats = allOfChats.map((promiseResult) =>
		_.pick(promiseResult.value, wantedFields),
	);

	const users = allOfChats.filter(
		(chat) => userIds.findIndex((userId) => userId === chat.id) >= 0,
	);
	const chats = allOfChats.filter(
		(chat) => chatIds.findIndex((chatId) => chatId === chat.id) >= 0,
	);

	const nonPrivateChats = allOfChats.filter((chat) => chat.type !== 'private');

	res.json({
		chats,
		chatsCount: chats.length,
		users,
		usersCount: users.length,
		nonPrivateChats,
		nonPrivateChatsCount: nonPrivateChats.length,
	});
});

module.exports = app;

mongoose
	.connect(config.dbUrl, {
		useNewUrlParser: true,
		useCreateIndex: true,
		useFindAndModify: true,
		useUnifiedTopology: true,
	})
	.then(() => {
		console.log('Database Connected.');
		app.listen(config.port, () => {
			console.log(`server started on port ${config.port}`);
			console.log(`webhook route token: ${config.webhookRouteToken}`);
			console.log(`statistics route token: ${config.statisticsRouteToken}`);
			if (config.isProduction)
				bot.telegram
					.setWebhook(`${config.baseUrl}/bot${config.webhookRouteToken}`, {
						allowed_updates: ['message', 'channel_post'],
					})
					.then(() => {
						console.log('webhook was set');
					})
					.catch(console.error);
			if (!config.isProduction) bot.launch();
		});
	})
	.catch(console.error);
