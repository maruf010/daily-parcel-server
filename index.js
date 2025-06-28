const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;


//middleware
app.use(cors());
app.use(express.json());


const serviceAccount = require("./firebase-admit-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vnbrepr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const parcelsCollection = client.db("parcelDB").collection("parcels");
        const paymentsCollection = client.db("parcelDB").collection('payments');
        const usersCollection = client.db("parcelDB").collection('users');
        const ridersCollection = client.db("parcelDB").collection('riders');



        //custom middleware jwt
        const verifyFBToken = async (req, res, next) => {
            // console.log('Headers in Middleware', req.headers);
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            //verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            };
        };


        app.post('/users', async (req, res) => {
            const email = req.body.email;

            const userExists = await usersCollection.findOne({ email });
            if (userExists) {
                //update last login if user already exists
                // await usersCollection.updateOne({ email },
                //     {
                //         $set: { last_log_in: new Date().toISOString() }
                //     }
                // );
                return res.status(200).send({ message: 'User already exists', inserted: false })
            };

            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });



        //be a rider
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await ridersCollection.insertOne(rider);
            res.send(result)
        });

        app.get('/riders/pending', async (req, res) => {
            try {
                const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                console.error('Error fetching pending riders:', error);
                res.status(500).send({ error: 'Internal server error' });
            }
        });
        app.patch("/riders/:id/status", async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { status }
            }

            try {
                const result = await ridersCollection.updateOne(query, updateDoc);
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: "Failed to update rider status" });
            }
        });
        app.get("/riders/active", async (req, res) => {
            const result = await ridersCollection.find({ status: "active" }).toArray();
            res.send(result);
        });



        // POST: Create a new parcel
        app.post('/parcels', async (req, res) => {
            const newParcel = req.body;
            const result = await parcelsCollection.insertOne(newParcel);
            res.send(result)
        });
        // GET: All parcels
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const userEmail = req.query.email;

                const query = userEmail ? { email: userEmail } : {};
                const options = {
                    sort: { createdAt: -1 }, // Newest first
                };

                const parcels = await parcelsCollection.find(query, options).toArray();
                res.send(parcels);

            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to get parcels' });
            }
        });
        //get Id
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });

                if (!parcel) {
                    return res.status(404).json({ error: 'Parcel not found' });
                }

                res.json(parcel);
            } catch (err) {
                res.status(500).json({ error: 'Invalid ID or server error' });
            }
        });
        // DELETE: Remove parcel by ID
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const parcelId = req.params.id;

                const result = await parcelsCollection.deleteOne({ _id: new ObjectId(parcelId) });
                res.send(result);

            } catch (error) {
                console.error("Error deleting parcel:", error);
                res.status(500).send({ error: "Failed to delete parcel" });
            }
        });



        app.get('/payments', verifyFBToken, async (req, res) => {
            console.log(req.headers);

            try {
                const userEmail = req.query.email;

                console.log('decoded', req.decoded);

                if (req.decoded.email !== userEmail) {
                    return res.status(403).send({ message: 'forbidden access' })
                }

                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } }; // Latest first

                const payments = await paymentsCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching payment history:', error);
                res.status(500).send({ message: 'Failed to get payments' });
            }
        });
        // POST: Record payment and update parcel status
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

                // 1. Update parcel's payment_status
                const updateResult = await parcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: 'Parcel not found or already paid' });
                }

                // 2. Insert payment record
                const paymentDoc = {
                    parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date(),
                };

                const paymentResult = await paymentsCollection.insertOne(paymentDoc);

                res.status(201).send({
                    message: 'Payment recorded and parcel marked as paid',
                    insertedId: paymentResult.insertedId,
                });

            } catch (error) {
                console.error('Payment processing failed:', error);
                res.status(500).send({ message: 'Failed to record payment' });
            }
        });

        //payment Intent
        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents;
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd',
                    payment_method_types: ['card'],
                })
                res.json({ clientSecret: paymentIntent.client_secret })
            }
            catch (error) {
                res.status(500).json({ error: error.message })
            }
        });



        app.post("/tracking", async (req, res) => {
            const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

            const log = {
                tracking_id,
                parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
                status,
                message,
                time: new Date(),
                updated_by,
            };

            const result = await trackingCollection.insertOne(log);
            res.send({ success: true, insertedId: result.insertedId });
        });






        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



// Routes
app.get('/', (req, res) => {
    res.send('Parcel Server is running')
})

app.listen(port, () => console.log(`Server running on port ${port}`));