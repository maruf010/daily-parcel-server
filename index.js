const express = require('express');
const app = express();
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);


app.use(cors());
app.use(express.json());


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

        // POST: Create a new parcel
        app.post('/parcels', async (req, res) => {
            const newParcel = req.body;
            const result = await parcelsCollection.insertOne(newParcel);
            res.send(result)
        });

        // GET: All parcels
        app.get('/parcels', async (req, res) => {
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


        app.get('/payments', async (req, res) => {
            try {
                const userEmail = req.query.email;

                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } }; // Latest first

                const payments = await paymentsCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching payment history:', error);
                res.status(500).send({ message: 'Failed to get payments' });
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





        //payment
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