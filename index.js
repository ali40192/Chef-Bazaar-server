const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;

const crypto = require("crypto");
const { log } = require("console");

const admin = require("firebase-admin");

// Initialize Firebase Admin (replace with your service account key path or env vars)
const serviceAccount = require("./chefbazarfirebaseadminSdk.json"); // Download from Firebase Console
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  return `LCB-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

///midleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fyk0nds.mongodb.net/?appName=Cluster0`;

////jwt verify
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log(decoded);
    next();
  } catch (err) {
    // console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

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
    const usersCollection = db.collection("users");
    const chefCollection = db.collection("chef-requests");

    /////varify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user && user.role !== "admin") {
        return res
          .status(403)
          .send({ message: "only Admin can access", role: user?.role });
      }
      next();
    };

    ////verify chef
    const verifyChef = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user && user.role !== "chef") {
        return res
          .status(403)
          .send({ message: "only chef can access", role: user?.role });
      }
      next();
    };

    ////meals api
    ////1.get 6 meals for home page
    app.get("/meals", async (req, res) => {
      const meals = await mealsCollection.find().limit(6).toArray();
      res.send(meals);
    });
    ///////1.2.get all meals for all meals page
    app.get("/allmeals", async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });

    ////get  meals by chef hoyto use hoi nai
    app.get("/mymeals/:email", verifyJWT, verifyChef, async (req, res) => {
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

    ////3.post a meal || create a meal || add a meal
    app.post("/meals", verifyJWT, verifyChef, async (req, res) => {
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
    app.get("/orders", verifyJWT, async (req, res) => {
      const result = orderCollection.find({ userEmail: req.tokenEmail });
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

      // Update the order (convert id to ObjectId)
      const orderUpdateResult = await orderCollection.updateOne(
        { _id: new ObjectId(paymentInfo.orderId) },
        { $set: { checkoutSessionId: session.id, paymentStatus: "pending" } }
      );
      console.log("order updateResult:", orderUpdateResult);
      res.send({ url: session.url, orderUpdateResult });
    });

    ////payment success//
    app.patch("/success-payment", async (req, res) => {
      const sessionId = req.body.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);

      if (session.payment_status === "paid") {
        // Generate trackingId once
        const trackingId = generateTrackingId();
        // console.log("Generated trackingId:", trackingId);

        // Update orderCollection
        const id = session.metadata.orderId;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            orderStatus: "confirmed",
            transectionId: session.payment_intent,
            trackingId: trackingId,
          },
        };
        const updateResult = await orderCollection.updateOne(query, updateDoc);
        console.log("orderCollection.updateOne result:", updateResult);

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
            status: "pending",
            chefId: meal.chefId,
            mealName: meal.foodName,
            quantity: session.metadata.quantity,
            paidAt: new Date(),
            trackingId: trackingId,
          };
          const insertResult = await paymentCollection.insertOne(orderInfo);
          return res.send({ updateResult, insertResult });
        }

        return res.send(updateResult);
      }

      res.send({ success: false });
    });

    ////user collection create or update //// all kinds of user here
    app.post("/users", async (req, res) => {
      const user = req.body;

      user.created_at = new Date().toISOString();
      user.last_loggedIn = new Date().toISOString();
      user.role = "user";
      user.status = "active";
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        const result = await usersCollection.updateOne(query, {
          $set: { last_loggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    /////get user role   ///
    app.get("/users/role", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    ///get user data by email
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const userDetails = await usersCollection.findOne(query);
      res.send(userDetails);
    });

    ////become a chef request
    app.post("/become-chef", verifyJWT, async (req, res) => {
      const { userDetails } = req.body;

      const userName = userDetails.name;
      const email = req.tokenEmail;
      const requestType = "chef";
      const requestStatus = "pending";

      const alreadyExist = await chefCollection.findOne({
        userEmail: email,
      });
      if (alreadyExist)
        return res.status(409).send({ message: "already exist" });

      const result = await chefCollection.insertOne({
        userName,
        userEmail: email,
        requestType,
        requestStatus,
      });
      res.send(result);
    });

    app.get("/chef-requests", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await chefCollection.find().toArray();

      res.send(result);
    });

    ////update user role
    app.patch("/update-role", verifyJWT, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;
      console.log(email, role);

      /////////usercollection a update koreche
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );

      ////jodi chef collection a exsist kore delate korte hobe
      await chefCollection.deleteOne({ userEmail: email });
      res.send(result);
    });

    /////get all users
    app.get("/all-users", verifyJWT, verifyAdmin, async (req, res) => {
      const adminEmail = req.tokenEmail;
      const result = await usersCollection
        .find({ email: { $ne: adminEmail } })
        .toArray();

      res.send(result);
    });

    /////get payment history
    // app.get("/payment-history/:email", async (req, res) => {
    //   const email = req.params.email;

    //   const query = { customer_email: email };
    //   const cursor = paymentCollection.find(query);
    //   const payments = await cursor.toArray();
    //   res.send(payments);
    // });

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
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("My Chef-Bazaar");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
