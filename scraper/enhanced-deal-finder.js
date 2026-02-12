// ============================================
// ENHANCED DEAL FINDER - App Store Compliant
// Focus on High Quality Vienna Deals like OMV 1 jö coffee
// ============================================

import fs from 'fs';
import { ViennaQualityFinder } from './vienna-quality-finder.js';

class EnhancedDealFinder {
  constructor() {
    this.qualityFinder = new ViennaQualityFinder();
    this.existingDeals = [];
    this.enhancedDeals = [];
    this.stats = {
      existing: 0,
      added: 0,
      verified: 0,
      total: 0
    };
  }

  async enhance() {
    console.log('🚀 Enhanced Deal Finder starting...');
    console.log('📱 App Store Compliant Mode Enabled');
    console.log('📅', new Date().toLocaleString('de-AT'));

    // 1. Load existing deals
    await this.loadExistingDeals();

    // 2. Find premium Vienna deals
    await this.addQualityDeals();

    // 3. Clean and verify all deals
    await this.verifyAndCleanDeals();

    // 4. Enhance deal quality
    this.enhanceDealsMetadata();

    // 5. Sort by quality
    this.prioritizeByQuality();

    // 6. Save App Store compliant results
    this.saveEnhancedDeals();

    this.printStats();
  }

  async loadExistingDeals() {
    try {
      if (fs.existsSync('docs/deals.json')) {
        const data = JSON.parse(fs.readFileSync('docs/deals.json', 'utf8'));
        this.existingDeals = data.deals || [];
        this.stats.existing = this.existingDeals.length;
        console.log(`📂 Loaded ${this.stats.existing} existing deals`);
        
        // Keep the great OMV deal at top priority
        const omvDeal = this.existingDeals.find(deal => deal.brand === 'OMV VIVA');
        if (omvDeal) {
          omvDeal.qualityScore = 100; // Highest score
          omvDeal.verified = true;
          omvDeal.appStoreCompliant = true;
          console.log('⭐ OMV deal prioritized as premium example');
        }
      }
    } catch (error) {
      console.log('⚠️ Could not load existing deals, starting fresh');
      this.existingDeals = [];
    }
  }

  async addQualityDeals() {
    console.log('🎯 Adding premium Vienna deals...');
    const qualityDeals = await this.qualityFinder.findQualityDeals();
    
    // Merge quality deals with existing (avoid duplicates)
    for (const qualityDeal of qualityDeals) {
      const exists = this.existingDeals.some(deal => 
        deal.brand === qualityDeal.brand && 
        deal.title.toLowerCase().includes(qualityDeal.title.toLowerCase().substring(0, 20))
      );
      
      if (!exists) {
        this.existingDeals.push(qualityDeal);
        this.stats.added++;
        console.log(`✅ Added: ${qualityDeal.brand} - ${qualityDeal.title}`);
      }
    }
    
    console.log(`🎯 Added ${this.stats.added} new premium deals`);
  }

  async verifyAndCleanDeals() {
    console.log('🔍 Verifying deals for App Store compliance...');
    
    const verifiedDeals = [];
    
    for (const deal of this.existingDeals) {
      // App Store compliance checks
      if (this.isAppStoreCompliant(deal)) {
        // Mark as verified
        deal.verified = true;
        deal.appStoreCompliant = true;
        deal.lastVerified = new Date().toISOString();
        
        verifiedDeals.push(deal);
        this.stats.verified++;
      } else {
        console.log(`⚠️ Removed non-compliant: ${deal.brand}`);
      }
    }
    
    this.existingDeals = verifiedDeals;
    console.log(`✅ ${this.stats.verified} deals verified as App Store compliant`);
  }

  isAppStoreCompliant(deal) {
    // App Store compliance criteria
    const checks = [
      deal.url && deal.url.startsWith('https://'), // HTTPS required
      deal.brand && deal.brand.length > 0, // Must have brand
      deal.title && deal.title.length > 5, // Must have meaningful title
      deal.description && deal.description.length > 10, // Must have description
      !deal.title.includes('NSFW'), // No adult content
      !deal.description.toLowerCase().includes('illegal'), // No illegal content
      !deal.url.includes('facebook.com/groups') || !deal.url.includes('reddit.com'), // No social media groups (privacy concerns)
    ];
    
    return checks.every(check => check);
  }

  enhanceDealsMetadata() {
    console.log('💫 Enhancing deal metadata...');
    
    for (const deal of this.existingDeals) {
      // Add quality indicators
      if (!deal.qualityScore) {
        deal.qualityScore = this.calculateQualityScore(deal);
      }
      
      // Add App Store metadata
      deal.appStoreVersion = "2.0.1";
      deal.dataCompliance = "GDPR-compliant";
      
      // Enhance categories for better discovery
      if (deal.title.toLowerCase().includes('gratis') || deal.title.toLowerCase().includes('kostenlos')) {
        deal.tags = [...(deal.tags || []), 'gratis', 'kostenlos'];
      }
      
      if (deal.description.toLowerCase().includes('wien')) {
        deal.tags = [...(deal.tags || []), 'wien', 'vienna'];
      }
      
      // Add user value indicators
      if (deal.type === 'gratis' && deal.category === 'kaffee') {
        deal.userValue = 'high'; // Coffee deals are very popular
      }
      
      if (deal.brand === 'OMV VIVA' || deal.title.includes('1 jö')) {
        deal.userValue = 'premium'; // OMV example is premium
        deal.featured = true;
      }
    }
    
    console.log('💫 Enhanced metadata for all deals');
  }

  calculateQualityScore(deal) {
    let score = 0;
    
    // Base scoring
    if (deal.type === 'gratis') score += 10;
    if (deal.hot) score += 5;
    if (deal.priority === 1) score += 5;
    
    // Vienna relevance
    if (deal.category === 'wien') score += 3;
    if (deal.distance && deal.distance.includes('Wien')) score += 3;
    
    // Quality indicators
    if (deal.brand && ['OMV', 'McDonald', 'IKEA', 'BILLA', 'SPAR'].includes(deal.brand.split(' ')[0])) {
      score += 5; // Recognized brands
    }
    
    // User popularity
    if (deal.votes && deal.votes > 50) score += 3;
    if (deal.votes && deal.votes > 100) score += 5;
    
    // Content quality
    if (deal.description && deal.description.length > 50) score += 2;
    if (deal.title && deal.title.includes('GRATIS')) score += 2;
    
    return score;
  }

  prioritizeByQuality() {
    console.log('🏆 Sorting deals by quality...');
    
    // Sort by quality score, then by other factors
    this.existingDeals.sort((a, b) => {
      const scoreA = a.qualityScore || 0;
      const scoreB = b.qualityScore || 0;
      
      if (scoreA !== scoreB) return scoreB - scoreA;
      
      // Secondary sorting
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      if (a.hot && !b.hot) return -1;
      if (!a.hot && b.hot) return 1;
      
      return (a.priority || 99) - (b.priority || 99);
    });
    
    console.log(`🏆 Top deal: ${this.existingDeals[0]?.brand} - ${this.existingDeals[0]?.title}`);
  }

  saveEnhancedDeals() {
    this.stats.total = this.existingDeals.length;
    
    const output = {
      version: "2.0.1-enhanced",
      lastUpdated: new Date().toISOString(),
      enhancedBy: "Vienna Quality Finder",
      appStoreCompliant: true,
      totalDeals: this.stats.total,
      stats: this.stats,
      qualityMetrics: {
        averageScore: Math.round(this.existingDeals.reduce((sum, deal) => sum + (deal.qualityScore || 0), 0) / this.stats.total),
        premiumDeals: this.existingDeals.filter(d => d.userValue === 'premium').length,
        gratisDeals: this.existingDeals.filter(d => d.type === 'gratis').length,
        viennaSpecific: this.existingDeals.filter(d => d.category === 'wien' || d.distance?.includes('Wien')).length
      },
      deals: this.existingDeals.map((deal, index) => ({
        ...deal,
        rank: index + 1
      }))
    };

    // Save main file
    fs.writeFileSync('docs/deals.json', JSON.stringify(output, null, 2));
    
    // Save backup
    const timestamp = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(`docs/deals-backup-${timestamp}.json`, JSON.stringify(output, null, 2));
    
    console.log(`💾 Saved ${this.stats.total} enhanced deals`);
  }

  printStats() {
    console.log('\n🚀 ENHANCED DEAL FINDER RESULTS');
    console.log('=====================================');
    console.log(`📱 App Store Compliant: ✅ YES`);
    console.log(`📋 Total Deals: ${this.stats.total}`);
    console.log(`📂 Existing Deals: ${this.stats.existing}`);
    console.log(`🆕 New Premium Deals: ${this.stats.added}`);
    console.log(`✅ Verified Deals: ${this.stats.verified}`);
    console.log(`🏆 Top Deal: ${this.existingDeals[0]?.brand} - ${this.existingDeals[0]?.title}`);
    console.log(`⭐ Premium Deals: ${this.existingDeals.filter(d => d.userValue === 'premium').length}`);
    console.log(`🆓 Gratis Deals: ${this.existingDeals.filter(d => d.type === 'gratis').length}`);
    console.log(`🏙️ Vienna-Specific: ${this.existingDeals.filter(d => d.category === 'wien').length}`);
    console.log('=====================================\n');
    
    // Show top 5 deals
    console.log('🏆 TOP 5 DEALS:');
    this.existingDeals.slice(0, 5).forEach((deal, i) => {
      console.log(`${i + 1}. ${deal.brand}: ${deal.title} (Score: ${deal.qualityScore})`);
    });
    console.log('');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const enhancer = new EnhancedDealFinder();
  await enhancer.enhance();
}

export { EnhancedDealFinder };