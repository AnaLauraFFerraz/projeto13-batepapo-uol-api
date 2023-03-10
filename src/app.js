import express from "express";
import cors from 'cors';
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from 'joi';
import dayjs from "dayjs";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const date = dayjs().format("hh:mm:ss")

const PORT = 5000;

const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
    await mongoClient.connect();
} catch (err) {
    res.sendStatus(500);
}

const db = mongoClient.db();

app.post("/participants", async (req, res) => {
    const { name } = req.body;

    const usernameSchema = joi.object({
        name: joi.string().required()
    });

    const validation = usernameSchema.validate({ name });

    if (validation.error) {
        return res.sendStatus(422);
    }

    try {
        const isUserActive = await db.collection("participants").findOne({ name });
        if (isUserActive) {
            return res.sendStatus(409);
        }

        const participants = {
            name: name,
            lastStatus: Date.now()
        };
        await db.collection("participants").insertOne(participants);

        const message = {
            from: name,
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: date,
        };
        await db.collection("messages").insertOne(message);

        res.sendStatus(201);
    } catch {
        res.sendStatus(500);
    }
})

app.get("/participants", async (req, res) => {
    try {
        let activeParticipants = await db.collection("participants").find().toArray();
        res.status(200).send(activeParticipants);
    } catch {
        res.sendStatus(500);
    }
})

app.post("/messages", async (req, res) => {
    const { to, text, type } = req.body;
    const from = req.headers.user;

    const time = dayjs(Date.now()).format("hh:mm:ss");

    const messageSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("private_message", "message").required()
    })

    const validation = messageSchema.validate({ to, text, type });

    if (validation.error) {
        return res.sendStatus(422);
    }

    try {
        const isUser = await db.collection("participants").findOne({ name: from })
        if (!isUser) {
            return res.sendStatus(422);
        }
    } catch {
        return res.sendStatus(500);
    }

    try {
        await db.collection("messages").insertOne({
            to,
            text,
            type,
            from,
            time,
        });
        res.status(201);
    } catch {
        res.status(500);
    }
});

app.get("/messages", async (req, res) => {
    const { user } = req.headers;
    let allMessages;
    let limit;

    try {
        allMessages = await db.collection("messages").find().toArray();
    } catch {
        res.status(422).send("Erro ao buscar mensagens")
    }

    if (req.query.limit) {
        limit = parseInt(req.query.limit);

        if (limit < 1 || isNaN(limit)) {
            return res.status(422).send("Limite inv??lido")
        }
    } else {
        limit = 100;
    }

    let userMessages = allMessages.filter((message) =>
        message.user === user ||
        message.from === user ||
        message.to === "Todos" ||
        message.to === user ||
        message.type === "status"
    );

    const limitedMessages = userMessages.slice(limit)
    res.send(limitedMessages)
})

app.post("/status", async (req, res) => {
    const user = req.headers.user;
    const time = Date.now();

    try {
        const isUser = await db.collection("participants").findOne({ name: user });
        if (!isUser) {
            return res.sendStatus(422);
        }
    } catch {
        res.sendStatus(500);
    }

    const participantStatus = { name: user, lastStatus: time };

    try {
        await db.collection("participants").updateOne({ name: user }, { $set: participantStatus });
        return res.sendStatus(200);
    } catch {
        res.sendStatus(500);
    }
})

setInterval(
    async () => {
        const now = Date.now();
        const time = dayjs(Date.now()).format("hh:mm:ss");

        const inactiveUsers = await db.collection("participants").find({
            lastStatus: { $lt: now - 10000 }
        }).toArray();

        inactiveUsers.forEach(async (user) => {
            await db.collection("participants").deleteOne({ name: user.name });
            await db.collection("messages").insertOne({
                from: user.name,
                to: "Todos",
                text: "sai da sala...",
                type: "status",
                time: time
            });
        })
    }, 15000)

app.delete("/messages/:id", async (req, res) => {
    const { id } = req.params;
    const name = req.headers.user;

    try {
        const message = await db.collection("messages").findOne({ _id: ObjectId(id) });

        if (!message) return res.sendStatus(404);

        if (message.from !== name) return res.sendStatus(401);

        await db.collection("messages").deleteOne({ _id: ObjectId(id) });

        res.sendStatus(200);
    } catch {
        res.sendStatus(500);
    }
});

app.listen(PORT);

app.put("/messages/:id", async (req, res) => {
    const { id } = req.params;
    const from = req.headers.user;
    const { to, text, type } = req.body;
    const time = dayjs(Date.now()).format("hh:mm:ss");

    const messageSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("private_message", "message").required()
    })

    const validation = messageSchema.validate({ to, text, type });

    if (validation.error) return res.sendStatus(422);

    try {
        const message = await db.collection("messages").findOne({ _id: ObjectId(id) });

        if (message.from !== from) return res.sendStatus(401);

        await db.collection("messages").updateOne(
            { _id: ObjectId(id) }, {
            $set: {
                text,
                time
            },
        }
        );
        res.sendStatus(201);
    } catch {
        res.sendStatus(500);
    }
});