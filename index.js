const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;

const crypto = require("crypto");

function generateTrackingId() {
  return `LCB-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

///midleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fyk0nds.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("chef_bazaar_db");
    const mealsCollection = db.collection("meals");
    const orderCollection = db.collection("order_collection");
    const paymentCollection = db.collection("payments");

    ////meals api
    ////1.get all meals
    app.get("/meals", async (req, res) => {
      const meals = await mealsCollection.find().limit(6).toArray();
      res.send(meals);
    });
    ///////1.2.get all meals for all meals page
    app.get("/allmeals", async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });

    ////get created meals by chef
    app.get("/mymeals/:email", async (req, res) => {
      const email = req.params.email;
      const result = mealsCollection.find({ userEmail: email });
      const meals = await result.toArray();
      res.send(meals);
    });

    ////2.get single meal
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    ////3.post a meal
    app.post("/meals", async (req, res) => {
      const meal = req.body;
      const result = await mealsCollection.insertOne(meal);
      res.send(result);
    });
    /////create my orders
    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await orderCollection.insertOne(order);
      res.send(result);
    });

    ////get my orders
    app.get("/orders/:email", async (req, res) => {
      const email = req.params.email;

      const result = orderCollection.find({ userEmail: email });
      const orders = await result.toArray();
      res.send(orders);
    });

    ///create payment
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo.mealName,
              },
              unit_amount: paymentInfo.price * 100,
            },
            quantity: paymentInfo.quantity,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: "payment",
        metadata: {
          foodId: paymentInfo.foodId,
          orderId: paymentInfo.orderId,
          quantity: paymentInfo.quantity,
        },
        success_url: `http://localhost:5173/dashboard/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://localhost:5173/meals/${paymentInfo?.foodId}`,
      });

      // Update the order
      await orderCollection.updateOne(
        { _id: paymentInfo.orderId },

        { $set: { checkoutSessionId: session.id, paymentStatus: "pending" } }
      );
      res.send({ url: session.url });
    });

    ////payment success//
    app.patch("/success-payment", async (req, res) => {
      const sessionId = req.body.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);
      const trackingId = generateTrackingId();

      if (session.payment_status === "paid") {
        // Update orderCollection

        const id = session.metadata.orderId;
        const query = { _id: new ObjectId(id) };

        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            orderStatus: "confirmed",
            trackingId: trackingId,
          },
        };
        const updateResult = await orderCollection.updateOne(query, updateDoc);

        // Save payment history to paymentCollection
        const meal = await mealsCollection.findOne({
          _id: new ObjectId(session.metadata.foodId),
        });
        const paymentExist = await paymentCollection.findOne({
          transectionId: session.payment_intent,
        });
        if (meal && !paymentExist) {
          const orderInfo = {
            price: session.amount_total / 100,
            currency: session.currency,
            customer_email: session.customer_email,
            foodId: session.metadata.foodId,

            orderId: session.metadata.orderId,
            transectionId: session.payment_intent,
            paymentStatus: session.payment_status,
            customer_email: session.customer_email,
            status: "pending",
            chefId: meal.chefId,
            mealName: meal.foodName,

            quantity: session.metadata.quantity,
            paidAt: new Date(),
          };
          const insertResult = await paymentCollection.insertOne(orderInfo);
          return res.send({ updateResult, insertResult });
        }

        return res.send(updateResult);
      }

      res.send({ success: false });
    });

    ////4.update a meal
    // app.put("/meals/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const meal = req.body;
    //   const options = { upsert: true };
    //   const updatedMeal = {
    //     $set: {
    //       name: meal.name,
    //       description: meal.description,
    //     }
    //   }
    // })

    ///delete a meal
    // app.delete("/meals/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await mealsCollection.deleteOne(query);
    //   res.send(result);
    // });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("My Chef-Bazaar");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
