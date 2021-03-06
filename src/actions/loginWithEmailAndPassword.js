export const middlewares = ['validateLoginFields','transformLogin','authenticateSilent'];
export default async function({email, password}) {
	const {jwtSign} = this.modules.auth;
	const {encrypt} = this.modules.cryptr;

	const {
		model
	} = this;
	let doc = await model('user').findOne({
		email, 
		password: encrypt(password)
	});
	if (doc) {

		if(this.req.session && doc.sessions.find(s=>s._id==this.req.session)==null){
			doc.sessions.push(this.req.session);
			await doc.save();
		}

		this.modules.analytics.recordEvent('loginWithEmailAndPassword',doc.toJSON()).catch(console.error);

		return {
			user: doc,
			token: jwtSign({
				userId: doc._id
			})
		};
	}else{
		return null;
	}
}