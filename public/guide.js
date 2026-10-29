// Release Guide: the step-by-step walkthrough shown to each player after they
// upload to the Showcase. Content is static, trusted HTML. Distributor pricing
// changes often, so we point players to each service instead of quoting prices.
window.RELEASE_GUIDE = [
  {
    id: 'master',
    kicker: 'Before you upload',
    title: 'Finalize your master',
    body: `<p>Streaming services play exactly the file you send, so start from the best version of your song: the final mix, mastered.</p>`,
    checklist: [
      'Export a <b>WAV</b> file (16-bit or 24-bit, 44.1 kHz or higher). Never upload an MP3 to a distributor.',
      'Aim for roughly <b>-14 LUFS</b> integrated loudness with peaks under <b>-1 dBTP</b>. Most platforms normalize to around there.',
      'Trim silence at the start, and let the ending ring out naturally.',
      'Listen on phone speakers, earbuds and a car before you call it done.',
    ],
    tip: 'Hired a mastering engineer through a Cardinal Records contract? Ask them for the final WAV and a backup copy.',
  },
  {
    id: 'artwork',
    kicker: 'Look the part',
    title: 'Create your cover art',
    body: `<p>Every release needs square artwork. Stores reject covers that break their rules, which delays your release.</p>`,
    checklist: [
      'Square image, at least <b>3000 x 3000 px</b>, JPG or PNG, RGB color.',
      'No website links, social handles, prices, or streaming-service logos on the cover.',
      'Text on the cover must match your artist name and release title.',
      'Use only images you made, paid for, or have a license to use.',
    ],
    tip: 'If a player designed your art in-game, make sure your contract says you can use it commercially.',
  },
  {
    id: 'credits',
    kicker: 'Give credit, get paid',
    title: 'Lock in your credits and splits',
    body: `<p>Everyone who wrote or performed on the track should be credited, and you should agree <b>in writing</b> how the money splits before release.</p>`,
    checklist: [
      'List every songwriter by <b>legal name</b>, plus producers, engineers and featured artists.',
      'Agree on songwriting splits (who wrote what %) and master splits (who owns the recording).',
      'Get featured artists to confirm how their name should appear.',
      'Save your agreements somewhere safe. Your Cardinal Records data export is a good start.',
    ],
    dynamic: 'credits',
    tip: 'Your in-game contracts are listed above so you know exactly who to credit.',
  },
  {
    id: 'distributor',
    kicker: 'Get on the platforms',
    title: 'Pick a distributor',
    body: `<p>Independent artists don't upload straight to Spotify or Apple Music. A <b>distributor</b> delivers your music to all the stores at once and collects your streaming royalties.</p>
      <div class="dist-grid">
        <div><b>DistroKid</b><span>Yearly subscription, unlimited releases, fast delivery.</span></div>
        <div><b>TuneCore</b><span>Subscription tiers, with publishing admin as an add-on.</span></div>
        <div><b>CD Baby</b><span>Pay per release, no yearly fee. Takes a small cut of royalties.</span></div>
        <div><b>Amuse / UnitedMasters / Ditto</b><span>Free and low-cost tiers with optional paid upgrades.</span></div>
      </div>`,
    checklist: [
      'Compare current pricing on each distributor\'s website. Plans change often.',
      'Check whether you keep 100% of royalties, or what percentage they take.',
      'Check what happens to your releases if you stop paying.',
      'Choose one distributor per song. Uploading the same song through two causes takedowns.',
    ],
    tip: 'Read the terms before you click agree, the same way you would review a Cardinal Records contract.',
  },
  {
    id: 'upload',
    kicker: 'The main event',
    title: 'Upload your release',
    body: `<p>Create your account with the distributor, start a new release (a <b>single</b> is one to three tracks), and fill in the details carefully. Metadata mistakes are the most common reason a release gets rejected.</p>`,
    checklist: [
      'Spell your artist name <b>exactly</b> the same way on every release.',
      'Enter the track title, featured artists (use the "featuring" field, not the title), genre and language.',
      'Mark the song <b>Explicit</b> if it has explicit lyrics.',
      'Let the distributor assign a free <b>ISRC</b> code if you don\'t have one.',
      'Upload your WAV and cover art, add songwriter names, and confirm you own the rights.',
    ],
    tip: 'If you sampled anyone else\'s music, clear the sample first or leave it out.',
  },
  {
    id: 'date',
    kicker: 'Plan the drop',
    title: 'Choose a release date',
    body: `<p>Set your release date at least <b>3 to 4 weeks</b> out. That gives stores time to process it and gives you time to pitch to playlists and build hype.</p>`,
    checklist: [
      'Pick a date 3+ weeks away. New music usually goes live on a Friday.',
      'Select every store you want, including Spotify, Apple Music, YouTube Music, Amazon, TikTok and Instagram.',
      'Turn on a pre-save or pre-order link if your distributor offers one.',
    ],
    tip: 'A planned release beats a rushed one. The season taught you deadlines, so use them.',
  },
  {
    id: 'profiles',
    kicker: 'Own your page',
    title: 'Claim your artist profiles',
    body: `<p>Once your release is delivered (even before it goes live) you can claim your official artist profiles and see your stats.</p>`,
    checklist: [
      '<b>Spotify for Artists</b>: claim your profile, add a photo and bio, and <b>pitch your unreleased song</b> to editorial playlists at least 7 days before release.',
      '<b>Apple Music for Artists</b>: claim your profile and check that your release is under the right artist.',
      '<b>YouTube</b>: ask your distributor about an Official Artist Channel.',
      '<b>Amazon Music for Artists</b> and others: claim them as you go.',
    ],
    tip: 'Use the same photo and bio everywhere so fans know it\'s really you.',
  },
  {
    id: 'royalties',
    kicker: 'Collect every dollar',
    title: 'Register to get paid',
    body: `<p>Your distributor pays you for streams of the <b>recording</b>. Songwriting earns separate royalties that you have to register for yourself.</p>`,
    checklist: [
      'Join a performing rights organization (PRO) as a songwriter, such as <b>BMI</b> or <b>ASCAP</b> in the US, <b>PRS</b> in the UK, or <b>SOCAN</b> in Canada. Then register each song.',
      'In the US, register with <b>The MLC</b> for streaming mechanical royalties, or use a publishing administrator.',
      'Sign up with <b>SoundExchange</b> (US) for digital radio royalties on your master recording.',
      'Register using the same song titles, splits and ISRCs as your distributor upload.',
    ],
    tip: 'This is the step most new artists skip, and it\'s money that is already yours.',
  },
  {
    id: 'promote',
    kicker: 'Make some noise',
    title: 'Promote your release',
    body: `<p>Your song is on the platforms. Now people need to hear it.</p>`,
    checklist: [
      'Share your pre-save link two to three weeks before release.',
      'Post short vertical videos (15 to 30 seconds) of the hook, behind the scenes, or the story of the song.',
      'Submit to independent playlist curators and blogs that cover your genre.',
      'Tell your Cardinal Records lobby. Your labelmates are your first fans.',
    ],
    tip: 'Releasing consistently grows an audience faster than one big release does.',
  },
  {
    id: 'live',
    kicker: 'Release day',
    title: 'Go live and check everything',
    body: `<p>Release day! Make sure everything landed where it should.</p>`,
    checklist: [
      'Search for your song on every platform and play it all the way through.',
      'Confirm it shows up under <b>your</b> artist profile, not someone else with the same name. If not, contact your distributor.',
      'Update your bio links and pin the release on your socials.',
      'Watch your first-week stats in Spotify for Artists and Apple Music for Artists.',
    ],
    tip: 'You made it from contract to commercial release. That is the whole label cycle. Congratulations!',
  },
];
